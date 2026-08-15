/**
 * Sign-in, shared by every competition page that writes anything.
 *
 * The order the panel offers is the order of decreasing exposure — extension,
 * remote signer, then a key made here — because that is the order in which a
 * key is safest, not the order in which it is easiest.
 *
 * Signing in is NOT the end of it. A key proves you hold a key; it does not
 * give you a name. Every path here hands the signer to a [ProfileGate], and
 * `onChange` only reports a usable signer once that gate is satisfied by a
 * kind-0 profile at least one relay accepted. Until then the caller sees `null`
 * and offers no create, register or check-in.
 */
import { KeyVaultSession } from '../signer/local-key.mjs?v=20260815-1';
import { decryptNcryptsec } from '../signer/nip49.mjs';
import {
  buildNostrConnectUri, createLocalSigner, createNip07Signer, createNip46Signer,
  parseNip46Uri, waitForNip07,
} from '../signer/signers.mjs?v=20260814-1';
import { Nip46ConnectionSession, buildResumeUri } from '../signer/nip46-connection.mjs?v=20260814-1';
import {
  bytesToHex, generateSecretKey, getPublicKey, nsecEncode, npubEncode, randomBytes,
} from '../protocol/nostr-event.mjs';
import { el, replace, copyWithExpiry, shortKey, announce } from './dom.mjs';
import { ProfileGate } from './profile-gate.mjs';

const METHOD_KEY = 'cruxcoach:competitions:method:v1';
const HISTORY_KEY = 'cruxcoachCompetitionSignIn';
const HISTORY_SCREENS = new Set([
  'root', 'new', 'signer', 'existing',
  'new-backup-choice', 'new-backup-raw', 'new-backup-encrypted', 'new-backup-encrypted-ready',
]);
const BACKUP_SCREENS = new Set([
  'new-backup-choice', 'new-backup-raw', 'new-backup-encrypted', 'new-backup-encrypted-ready',
]);
const AMBER_CONNECT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

function isAndroidBrowser() {
  return /Android/i.test(globalThis.navigator?.userAgent || '');
}

function entryModeForScreen(screen) {
  if (screen === 'root') return null;
  if (screen === 'new' || BACKUP_SCREENS.has(screen)) return 'new';
  return screen;
}

export class SignIn {
  /**
   * @param {object} options
   * @param {(key: string, values?: object) => string} options.t translator
   * @param {HTMLElement} options.mount
   * @param {(signer: object|null) => void} options.onChange
   */
  constructor({ t, mount, onChange, pool, gateMount }) {
    this.t = t;
    this.mount = mount;
    this.onChange = onChange;
    this.signer = null;
    this.session = new KeyVaultSession();
    this.remoteSession = new Nip46ConnectionSession();
    this.entryMode = null;
    this.pendingKey = null;
    this.backupMode = null;
    this.pendingNcryptsec = null;
    this.error = null;
    this.busy = false;
    this.profile = null;
    this.historyPath = globalThis.window?.location?.pathname || '';
    this.popStateHandler = (event) => {
      const navigation = event.state?.[HISTORY_KEY];
      if (!navigation || navigation.path !== this.historyPath) return;
      // Once sign-in completed, one press of Browser Back should leave this
      // flow instead of visibly stopping on each now-obsolete sign-in entry.
      if (this.signer) {
        const depth = Number.isInteger(navigation.depth)
          ? navigation.depth : (navigation.screen === 'root' ? 0 : 1);
        if (depth > 0 || !event.state?.cruxcoachCompetitionWizard) {
          globalThis.window?.history?.back();
        }
        return;
      }
      // A generated secret exists only in memory. After a hard reload, skip
      // stale backup entries instead of rendering a broken half-finished step.
      if (BACKUP_SCREENS.has(navigation.screen) && !this.pendingKey) {
        globalThis.window?.history?.back();
        return;
      }
      this.applyNavigation(navigation.screen);
    };
    this.installNavigation();
    this.gate = pool
      ? new ProfileGate({
        t,
        mount: gateMount || mount,
        pool,
        onReady: (profile) => {
          this.profile = profile;
          this.render();
          this.onChange(this.signer, profile);
        },
        // Backing out of the profile step signs out. A signed-in user with no
        // profile has no capabilities at all, and a screen offering none of
        // them is more confusing than being signed out.
        onCancel: () => this.signOut(),
      })
      : null;
  }

  installNavigation() {
    const browser = globalThis.window;
    const history = browser?.history;
    if (!this.historyPath || !history?.replaceState || !history?.pushState) return;
    const current = history.state?.[HISTORY_KEY];
    if (!current || current.path !== this.historyPath || !HISTORY_SCREENS.has(current.screen)) {
      history.replaceState({
        ...(history.state || {}),
        [HISTORY_KEY]: { path: this.historyPath, screen: 'root', depth: 0 },
      }, '');
    }
    browser.addEventListener('popstate', this.popStateHandler);
  }

  navigationScreen() {
    const navigation = globalThis.window?.history?.state?.[HISTORY_KEY];
    if (navigation?.path !== this.historyPath || !HISTORY_SCREENS.has(navigation.screen)) return 'root';
    return navigation.screen;
  }

  applyNavigation(screen) {
    const target = HISTORY_SCREENS.has(screen) ? screen : 'root';
    if (!BACKUP_SCREENS.has(target) && this.pendingKey) {
      // The generated identity has not been published. Browser Back must wipe
      // it, but must not delete an older encrypted vault from this device.
      this.session.lock();
      this.session = new KeyVaultSession();
      this.pendingKey = null;
      this.backupMode = null;
      this.pendingNcryptsec = null;
    }
    if (target === 'new-backup-choice') this.backupMode = null;
    if (target === 'new-backup-raw') this.backupMode = 'raw';
    if (target === 'new-backup-encrypted') this.backupMode = 'encrypted';
    if (target === 'new-backup-encrypted-ready') this.backupMode = 'encrypted-ready';
    this.entryMode = entryModeForScreen(target);
    this.error = null;
    this.render();
  }

  navigate(screen, { replace = false } = {}) {
    const target = HISTORY_SCREENS.has(screen) ? screen : 'root';
    const history = globalThis.window?.history;
    if (this.historyPath && history?.pushState && history?.replaceState) {
      const current = history.state?.[HISTORY_KEY];
      const currentDepth = Number.isInteger(current?.depth) ? current.depth : 0;
      history[replace ? 'replaceState' : 'pushState']({
        ...(history.state || {}),
        [HISTORY_KEY]: { path: this.historyPath, screen: target, depth: replace ? currentDepth : currentDepth + 1 },
      }, '');
    }
    this.applyNavigation(target);
  }

  navigateBack() {
    const history = globalThis.window?.history;
    if (this.navigationScreen() !== 'root' && history?.back) history.back();
    else this.navigate('root', { replace: true });
  }

  get pubkey() { return this.signer?.pubkey || null; }

  /** True once a kind-0 profile exists; the caller gates writes on this. */
  get ready() { return Boolean(this.signer) && (!this.gate || this.gate.ready); }

  /** The name to use in a competition, never contact details. */
  get displayName() {
    return this.gate?.displayName || (this.signer ? shortKey(this.signer.pubkey) : '');
  }

  storedMethod() {
    try { return localStorage.getItem(METHOD_KEY); } catch { return null; }
  }

  rememberMethod(method) {
    try { localStorage.setItem(METHOD_KEY, method); } catch { /* private mode */ }
  }

  async use(signer, method) {
    this.signer = signer;
    if (method === 'local') {
      await this.session.enableReloadResume();
      this.pendingKey = null;
      this.backupMode = null;
      this.pendingNcryptsec = null;
    }
    this.profile = null;
    this.error = null;
    if (method) this.rememberMethod(method);
    this.render();
    if (!this.gate) { this.onChange(signer, null); return; }
    // The gate reports readiness itself; until it does, the caller keeps
    // seeing `null` and offers no write.
    await this.gate.check(signer);
  }

  /**
   * Sign out — the plaintext key is zeroed and the encrypted vault stays.
   *
   * Deliberately not "delete my key": somebody signing out on their own phone
   * expects to come back with their passphrase, and a sign-out that destroyed
   * the only copy of a key would be a data-loss button labelled as a session
   * button. [forgetKey] is the destructive one, and it asks first.
   *
   * For NIP-46 this closes the live relay session but retains the encrypted
   * client credential. The separate remove action also sends NIP-46 `logout`
   * where supported and deletes the credential from this browser.
   */
  signOut() {
    this.signer?.close();
    this.signer = null;
    this.profile = null;
    this.gate?.reset();
    this.session.lock();
    this.remoteSession.lock();
    this.remoteSession.clearLive();
    this.entryMode = null;
    try { localStorage.removeItem(METHOD_KEY); } catch { /* private mode */ }
    this.navigate('root', { replace: true });
    this.onChange(null, null);
  }

  /** Revoke the paired client where supported, then erase its encrypted credential. */
  async forgetNip46() {
    if (!confirm(this.t('signin.bunker.remove.confirm'))) return;
    if (this.signer?.kind === 'nip46') {
      try { await this.signer.logout?.(); } catch { this.signer.close(); }
      this.signer = null;
    }
    this.profile = null;
    this.gate?.reset();
    this.remoteSession.forget();
    this.entryMode = null;
    try { localStorage.removeItem(METHOD_KEY); } catch { /* private mode */ }
    this.navigate('root', { replace: true });
    this.onChange(null, null);
    announce(this.t('signin.bunker.remove.done'));
  }

  showForgetKeyDialog() {
    const close = (dialog) => dialog.parentNode?.removeChild(dialog);
    const dialog = el('dialog', {
      className: 'key-forget-dialog',
      attrs: { 'aria-labelledby': 'forget-key-title', 'aria-describedby': 'forget-key-copy' },
      on: { close: (event) => close(event.currentTarget) },
    }, [
      el('h2', { attrs: { id: 'forget-key-title' }, text: this.t('signin.forget.title') }),
      el('p', { attrs: { id: 'forget-key-copy' }, text: this.t('signin.forget.explainer') }),
      el('div', { className: 'button-row' }, [
        el('button', {
          className: 'quiet', text: this.t('signin.forget.cancel'),
          on: { click: () => close(dialog) },
        }),
        el('button', {
          className: 'danger', text: this.t('signin.forget.remove'),
          on: { click: () => { close(dialog); this.forgetKey(); } },
        }),
      ]),
    ]);
    this.mount.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', 'open');
    dialog.querySelector('.quiet')?.focus?.();
  }

  /** Remove only this browser's encrypted key copy after explicit confirmation. */
  forgetKey() {
    this.signer?.close();
    this.signer = null;
    this.profile = null;
    this.gate?.reset();
    this.session.forget();
    this.entryMode = null;
    try { localStorage.removeItem(METHOD_KEY); } catch { /* private mode */ }
    this.navigate('root', { replace: true });
    this.onChange(null, null);
    announce(this.t('signin.forget.done'));
  }

  async run(work) {
    this.busy = true;
    this.error = null;
    this.render();
    try {
      await work();
    } catch (err) {
      this.error = err.code === 'nip46_invitation_used'
        ? this.t('signin.bunker.invitation_used')
        : (err.message || String(err));
      announce(this.error, { assertive: true });
    } finally {
      this.busy = false;
      this.render();
    }
  }

  validateRemotePassphrase(passphrase, repeat) {
    if (!this.remoteSession.storage) throw new Error(this.t('signin.bunker.storage_unavailable'));
    if (passphrase.length < 8) throw new Error(this.t('signin.bunker.passphrase_short'));
    if (passphrase !== repeat) throw new Error(this.t('signin.bunker.passphrase_mismatch'));
  }

  async finishRemotePairing(signer, passphrase, { persist = true } = {}) {
    const connection = {
      remoteSignerPubkey: signer.remoteSignerPubkey,
      userPubkey: signer.pubkey,
      relays: signer.relays,
    };
    if (persist) {
      try {
        await this.remoteSession.persist(connection, passphrase);
      } catch (error) {
        signer.close();
        this.remoteSession.forget();
        throw error;
      }
    }
    this.remoteSession.rememberLive(connection);
    try {
      await this.use(signer, 'nip46');
    } catch (error) {
      signer.close();
      this.remoteSession.lock();
      throw error;
    }
  }

  render() {
    const { t } = this;
    if (this.signer) {
      const name = this.displayName || t('account.getting_ready');
      const methodKey = this.signer.kind === 'nip07' ? 'account.method.extension'
        : this.signer.kind === 'nip46' ? 'account.method.signer' : 'account.method.device';
      replace(this.mount, el('section', { className: 'session-bar', attrs: { 'aria-label': t('account.title') } }, [
        el('div', { className: 'session-avatar', attrs: { 'aria-hidden': 'true' }, text: name.slice(0, 1).toLocaleUpperCase() }),
        el('div', { className: 'session-person' }, [
          el('strong', { text: name }),
          el('span', { className: 'small', text: t(this.ready ? 'account.ready' : 'account.getting_ready') }),
        ]),
        el('details', { className: 'session-menu' }, [
          el('summary', { text: t('account.manage') }),
          el('div', { className: 'session-menu-panel' }, [
            el('strong', { text: t('account.title') }),
            el('p', { className: 'small', text: t(methodKey) }),
            this.ready && this.gate ? el('button', {
              className: 'quiet', text: t('profile.edit'), on: { click: () => this.gate.edit() },
            }) : null,
            el('button', {
              text: t('signin.out'), on: { click: () => this.signOut() },
            }),
            // Only for a key this device is actually holding. Signing out of an
            // extension or a bunker leaves nothing here to forget.
            this.session?.hasStoredKey?.() ? el('button', {
              className: 'danger',
              text: t('signin.forget'),
              on: { click: () => this.showForgetKeyDialog() },
            }) : null,
            this.signer.kind === 'nip46' && this.remoteSession.hasStoredConnection() ? el('button', {
              className: 'danger',
              text: t('signin.bunker.remove'),
              on: { click: () => this.run(async () => this.forgetNip46()) },
            }) : null,
            el('details', { className: 'identity-details' }, [
              el('summary', { text: t('account.details') }),
              el('p', { className: 'small mono selectable', text: shortKey(this.signer.pubkey) }),
              el('p', { className: 'small', text: t('account.details.hint') }),
            ]),
          ]),
        ]),
      ]));
      return;
    }

    if (this.pendingKey) { this.renderBackup(); return; }
    const children = [el('h2', { text: t('signin.title') }), el('p', { text: t('signin.intro') })];
    if (this.error) children.push(el('div', { className: 'notice bad' }, [el('p', { text: this.error })]));
    if (this.busy) children.push(el('p', { className: 'small', text: t('signin.working') }));

    if (!this.entryMode) {
      children.push(
        el('h3', { text: t('signin.choice.title') }),
        el('div', { className: 'signin-choice-grid' }, [
          el('button', {
            className: 'signin-choice',
            attrs: { type: 'button' },
            on: { click: () => this.navigate('new') },
          }, [
            el('strong', { text: t('signin.choice.new') }),
            el('span', { className: 'small', text: t('signin.choice.new.hint') }),
          ]),
          el('button', {
            className: 'signin-choice',
            attrs: { type: 'button' },
            on: { click: () => this.navigate('existing') },
          }, [
            el('strong', { text: t('signin.choice.existing') }),
            el('span', { className: 'small', text: t('signin.choice.existing.hint') }),
          ]),
        ]),
      );
      replace(this.mount, el('div', { className: 'card' }, children));
      return;
    }

    const pathTitle = this.entryMode === 'new' ? 'signin.new.title'
      : this.entryMode === 'signer' ? 'signin.signer.title' : 'signin.existing.title';
    children.push(el('div', { className: 'row between signin-path-heading' }, [
      el('h3', { text: t(pathTitle) }),
      el('button', {
        className: 'quiet', text: t('signin.choice.back'),
        on: { click: () => this.navigateBack() },
      }),
    ]));

    const alternativeMethods = [el('div', { className: 'card raised' }, [
      el('h3', { text: t('signin.extension') }),
      el('p', { className: 'small', text: t('signin.extension.hint') }),
      el('div', { className: 'row' }, [
        el('a', {
          className: 'button', text: t('signin.extension.chrome'),
          attrs: {
            href: 'https://chromewebstore.google.com/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp',
            target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer',
          },
        }),
        el('a', {
          className: 'button', text: t('signin.extension.firefox'),
          attrs: {
            href: 'https://addons.mozilla.org/firefox/addon/nos2x-fox/',
            target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer',
          },
        }),
      ]),
      el('button', {
        className: 'primary',
        text: t('signin.extension'),
        attrs: { disabled: this.busy },
        on: { click: () => this.run(async () => this.use(await createNip07Signer(), 'nip07')) },
      }),
    ])];

    // 2. remote signer
    const androidBrowser = isAndroidBrowser();
    const remoteChildren = [
      el('h3', { text: t('signin.bunker') }),
      el('p', { className: 'small', text: t('signin.bunker.hint') }),
      !androidBrowser && el('a', {
        className: 'button', text: t('signin.bunker.amber'),
        attrs: {
          href: 'https://github.com/greenart7c3/Amber/releases',
          target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer',
        },
      }),
    ];
    const savedRemote = this.remoteSession.describe();
    const directClientSecret = androidBrowser ? generateSecretKey() : null;
    const directUri = androidBrowser ? buildNostrConnectUri({
      clientPubkey: getPublicKey(directClientSecret),
      relays: AMBER_CONNECT_RELAYS,
      secret: bytesToHex(randomBytes(16)),
    }) : '';
    const directAmberAction = () => androidBrowser && el('a', {
      className: 'button primary',
      text: t('signin.bunker.open_amber'),
      attrs: { href: directUri },
      on: {
        click: (event) => {
          if (this.busy) { event.preventDefault(); return; }
          this.busy = true;
          this.error = null;
          this.remoteSession.adopt(directClientSecret);
          // Keep this client credential only in the browser tab. Amber remains
          // the signer and can approve a fresh pairing next session; inventing
          // a second web passphrase here only makes the safer path harder.
          void createNip46Signer(directUri, {
            clientSecret: directClientSecret,
            touchClient: () => this.remoteSession.touch(),
          }).then(
            (signer) => this.finishRemotePairing(signer, '', { persist: false }),
          ).catch((error) => {
            this.remoteSession.lock();
            this.error = error.message || String(error);
            announce(this.error, { assertive: true });
          }).finally(() => {
            this.busy = false;
            this.render();
          });
        },
      },
    });
    if (this.remoteSession.hasStoredConnection() && savedRemote) {
      const pass = el('input', { attrs: { type: 'password', id: 'bunker-pass', autocomplete: 'current-password' } });
      const savedControls = [
        el('p', { className: 'small', text: t('signin.bunker.saved') }),
        el('p', { className: 'small mono', text: shortKey(savedRemote.user_pubkey) }),
        el('label', { attrs: { for: 'bunker-pass' }, text: t('signin.passphrase') }, [pass]),
        el('button', {
          className: 'primary', text: t('signin.bunker.unlock'), attrs: { disabled: this.busy },
          on: {
            click: () => this.run(async () => {
              const { connection, secretKey } = await this.remoteSession.unlock(pass.value);
              pass.value = '';
              try {
                const signer = await createNip46Signer(buildResumeUri(connection), {
                  clientSecret: secretKey,
                  resume: true,
                  expectedUserPubkey: connection.user_pubkey,
                  touchClient: () => this.remoteSession.touch(),
                });
                this.remoteSession.rememberLive({
                  remoteSignerPubkey: signer.remoteSignerPubkey,
                  userPubkey: signer.pubkey,
                  relays: signer.relays,
                });
                await this.use(signer, 'nip46');
              } catch (error) {
                this.remoteSession.lock();
                throw error;
              }
            }),
          },
        }),
        el('button', {
          className: 'quiet danger', text: t('signin.bunker.remove'),
          on: { click: () => this.run(async () => this.forgetNip46()) },
        }),
      ];
      remoteChildren.push(
        directAmberAction(),
        ...(androidBrowser ? [el('details', { className: 'disclosure' }, [
          el('summary', { text: t('signin.bunker.saved') }),
          ...savedControls,
        ])] : savedControls),
      );
    } else {
      const bunkerInput = el('input', {
        attrs: { type: 'text', placeholder: t('signin.bunker.placeholder'), id: 'bunker-uri', autocomplete: 'off', spellcheck: 'false' },
      });
      const savePass = el('input', {
        attrs: { type: 'password', id: 'bunker-save-pass', autocomplete: 'new-password' },
      });
      const repeatPass = el('input', {
        attrs: { type: 'password', id: 'bunker-save-repeat', autocomplete: 'new-password' },
      });
      const manualControls = [
        el('p', { className: 'small', text: t('signin.bunker.save_hint') }),
        el('label', { attrs: { for: 'bunker-save-pass' }, text: t('signin.bunker.save_passphrase') }, [savePass]),
        el('label', { attrs: { for: 'bunker-save-repeat' }, text: t('signin.bunker.save_repeat') }, [repeatPass]),
        el('p', { className: 'small', text: t(androidBrowser
          ? 'signin.bunker.paste_fallback' : 'signin.bunker.paste_hint') }),
        el('label', { attrs: { for: 'bunker-uri' }, text: t('signin.bunker') }, [bunkerInput]),
        el('button', {
          text: t('signin.bunker.connect'),
          attrs: { disabled: this.busy },
          on: {
            click: () => this.run(async () => {
              const uri = bunkerInput.value.trim();
              if (parseNip46Uri(uri)?.scheme !== 'bunker') throw new Error(t('signin.bunker.only_bunker'));
              this.validateRemotePassphrase(savePass.value, repeatPass.value);
              this.remoteSession.adopt(generateSecretKey());
              try {
                const signer = await createNip46Signer(uri, {
                  clientSecret: this.remoteSession.secretKey,
                  touchClient: () => this.remoteSession.touch(),
                });
                await this.finishRemotePairing(signer, savePass.value);
                bunkerInput.value = '';
                savePass.value = '';
                repeatPass.value = '';
              } catch (error) {
                this.remoteSession.lock();
                throw error;
              }
            }),
          },
        }),
      ];
      remoteChildren.push(
        directAmberAction(),
        ...(androidBrowser ? [el('details', { className: 'disclosure' }, [
          el('summary', { text: t('signin.bunker.paste_fallback') }),
          ...manualControls,
        ])] : manualControls),
      );
    }
    const remoteCard = el('div', { className: 'card raised' }, remoteChildren);
    if (savedRemote && this.remoteSession.hasStoredConnection()) alternativeMethods.unshift(remoteCard);
    else alternativeMethods.push(remoteCard);

    // The local-key card is registration in the new-identity branch and an
    // encrypted-vault unlock control in the existing-identity branch.
    const localChildren = [
      el('h3', { text: t(this.entryMode === 'new' ? 'signin.local' : 'signin.local.saved') }),
      el('p', {
        className: 'small',
        text: t(this.entryMode === 'new' ? 'signin.local.hint' : 'signin.local.saved.hint'),
      }),
    ];
    if (this.entryMode === 'existing' && this.session.hasStoredKey()) {
      const pass = el('input', { attrs: { type: 'password', id: 'unlock-pass', autocomplete: 'current-password' } });
      localChildren.push(
        el('p', { className: 'small mono', text: shortKey(this.session.storedPubkey()) }),
        el('label', { attrs: { for: 'unlock-pass' }, text: t('signin.passphrase') }, [pass]),
        el('button', {
          className: 'primary',
          text: t('signin.local.unlock'),
          attrs: { disabled: this.busy },
          on: {
            click: () => this.run(async () => {
              await this.session.unlock(pass.value);
              pass.value = '';
              await this.use(createLocalSigner(this.session), 'local');
            }),
          },
        }),
        el('button', {
          className: 'quiet danger',
          text: t('key.forget'),
          on: { click: () => this.showForgetKeyDialog() },
        }),
      );
    } else if (this.entryMode === 'new') {
      localChildren.push(
        this.session.hasStoredKey()
          ? el('div', { className: 'notice warn' }, [el('p', { text: t('signin.new.replace.warning') })])
          : null,
        el('ol', { className: 'signin-steps' }, [
          el('li', { text: t('signin.local.step.create') }),
          el('li', { text: t('signin.local.step.backup') }),
          el('li', { text: t('signin.local.step.profile') }),
        ]),
        el('button', {
          className: 'primary',
          text: t('signin.local.action'),
          attrs: { disabled: this.busy },
          on: {
            click: () => this.run(async () => {
              if (this.session.hasStoredKey() && !confirm(t('signin.new.replace.confirm'))) return;
              this.session = new KeyVaultSession();
              this.pendingKey = this.session.generate();
              this.backupMode = null;
              this.pendingNcryptsec = null;
              this.navigate('new-backup-choice');
            }),
          },
        }),
      );

    }

    // Re-import can restore the convenient encrypted browser copy that
    // "Forget" removed. The choice is explicit and defaults to the normal
    // personal-device flow; a shared device remains one uncheck away.
    if (this.entryMode === 'existing') {
      const importedNsec = el('input', {
        attrs: {
          type: 'password', id: 'import-nsec', autocomplete: 'off',
          autocapitalize: 'none', spellcheck: 'false', placeholder: t('signin.import.placeholder'),
        },
      });
      const importPass = el('input', { attrs: {
        type: 'password', id: 'import-pass', autocomplete: 'current-password',
      } });
      const rememberImport = el('input', { attrs: {
        type: 'checkbox', id: 'import-remember', checked: 'checked',
      } });
      const importFile = el('input', { attrs: { type: 'file', id: 'import-file', accept: '.ncryptsec,text/plain' } });
      const importFeedback = el('p', {
        className: 'small', attrs: { role: 'alert', 'aria-live': 'assertive' },
      });
      alternativeMethods.push(el('div', { className: 'card raised' }, [
        el('h3', { text: t('signin.import') }),
        el('p', { className: 'small', text: t('signin.import.hint') }),
        el('div', { className: 'notice warn' }, [
          el('p', { text: t('signin.import.warning') }),
        ]),
        el('label', { attrs: { for: 'import-nsec' } }, [
          el('span', { text: t('signin.import.label') }), importedNsec,
        ]),
        el('label', { attrs: { for: 'import-file' } }, [
          el('span', { text: t('signin.import.file') }), importFile,
        ]),
        el('label', { attrs: { for: 'import-pass' } }, [
          el('span', { text: t('signin.import.passphrase') }),
          el('span', { className: 'hint', text: t('signin.import.passphrase.hint') }),
          importPass,
        ]),
        el('label', { className: 'inline', attrs: { for: 'import-remember' } }, [
          rememberImport, el('span', { text: t('signin.import.remember') }),
        ]),
        el('p', { className: 'small', text: t('signin.import.remember.hint') }),
        importFeedback,
        el('button', {
          text: t('signin.import.action'),
          attrs: { disabled: this.busy },
          on: {
            click: () => this.run(async () => {
              let session = null;
              try {
                const uploaded = importFile.files?.[0];
                const input = (uploaded ? await uploaded.text() : importedNsec.value).trim();
                const remember = rememberImport.checked;
                session = remember ? new KeyVaultSession() : new KeyVaultSession({ storage: null });
                if (input.startsWith('ncryptsec1')) {
                  session.importKey(await decryptNcryptsec(input, importPass.value));
                  if (remember) session.saveNcryptsec(input);
                } else {
                  session.importKey(input);
                  if (remember) await session.persist(importPass.value);
                }
                importedNsec.value = '';
                importPass.value = '';
                this.session = session;
                await this.use(createLocalSigner(session), 'local');
              } catch (err) {
                session?.lock();
                importedNsec.value = '';
                importFeedback.textContent = err.message || String(err);
                throw err;
              }
            }),
          },
        }),
      ]));
    }
    if (this.entryMode === 'new') {
      children.push(
        el('div', { className: 'signin-path-grid' }, [
          el('section', { className: 'card raised recommended-path' }, [
            el('span', { className: 'badge ok', text: t('signin.recommended') }),
            el('h3', { text: t('signin.new.signer') }),
            el('p', { className: 'small', text: t('signin.new.signer.hint') }),
            el('button', {
              className: 'primary',
              text: t('signin.new.signer.action'),
              on: { click: () => this.navigate('signer') },
            }),
          ]),
          el('div', { className: 'card raised' }, localChildren),
        ]),
      );
    } else if (this.entryMode === 'signer') {
      children.push(...alternativeMethods);
    } else {
      if (this.session.hasStoredKey()) alternativeMethods.unshift(el('div', { className: 'card raised' }, localChildren));
      children.push(...alternativeMethods);
    }

    replace(this.mount, el('div', { className: 'card' }, children));
  }

  /** Let the person choose one portable backup format before exposing a key. */
  renderBackup() {
    const { t } = this;
    if (this.backupMode === 'raw') { this.renderRawBackup(); return; }
    if (this.backupMode === 'encrypted') { this.renderEncryptedSetup(); return; }
    if (this.backupMode === 'encrypted-ready') { this.renderEncryptedBackup(); return; }
    replace(this.mount, el('div', { className: 'card' }, [
      el('h2', { text: t('key.choice.title') }),
      el('p', { className: 'lede', text: t('key.choice.hint') }),
      el('div', { className: 'signin-path-grid backup-choice-grid' }, [
        el('section', { className: 'card raised recommended-path' }, [
          el('span', { className: 'badge ok', text: t('signin.recommended') }),
          el('h3', { text: t('key.choice.encrypted') }),
          el('p', { className: 'small', text: t('key.choice.encrypted.hint') }),
          el('button', { className: 'primary', text: t('key.choice.encrypted.action'), on: {
            click: () => { this.pendingNcryptsec = null; this.navigate('new-backup-encrypted'); },
          } }),
        ]),
        el('section', { className: 'card raised' }, [
          el('h3', { text: t('key.choice.raw') }),
          el('p', { className: 'small', text: t('key.choice.raw.hint') }),
          el('button', { text: t('key.choice.raw.action'), on: {
            click: () => { this.pendingNcryptsec = null; this.navigate('new-backup-raw'); },
          } }),
        ]),
      ]),
      el('button', { className: 'quiet backup-back', text: t('signin.choice.back'), on: { click: () => this.navigateBack() } }),
    ]));
  }

  renderRawBackup() {
    const { t } = this;
    const nsec = this.pendingKey.nsec;
    const confirmed = el('input', { attrs: { type: 'checkbox', id: 'backup-confirm' } });
    const feedback = el('p', { className: 'small', attrs: { role: 'status', 'aria-live': 'polite' } });
    const masked = '••••••••••••••••••••••••••••••••';
    const secret = el('div', {
      className: 'secret', attrs: { role: 'text', 'aria-describedby': 'nsec-warning' }, text: masked,
    });
    const reveal = el('button', {
      className: 'quiet secret-reveal', text: '👁',
      attrs: { type: 'button', 'aria-label': t('key.reveal'), 'aria-pressed': 'false' },
      on: {
        click: () => {
          const showing = reveal.getAttribute('aria-pressed') === 'true';
          secret.textContent = showing ? masked : nsec;
          reveal.setAttribute('aria-pressed', String(!showing));
          reveal.setAttribute('aria-label', t(showing ? 'key.reveal' : 'key.hide'));
        },
      },
    });

    replace(this.mount, el('div', { className: 'card' }, [
      el('h2', { text: t('key.raw.title') }),
      el('div', { className: 'notice warn', attrs: { id: 'nsec-warning' } }, [
        el('p', { text: t('key.warning') }),
      ]),
      el('ul', { className: 'key-practices' }, [
        el('li', { text: t('key.practice.password_manager') }),
        el('li', { text: t('key.practice.private') }),
      ]),
      el('div', { className: 'secret-row' }, [secret, reveal]),
      el('div', { className: 'row' }, [
        el('button', {
          text: t('key.copy'),
          on: {
            click: async () => {
              await copyWithExpiry(nsec);
              feedback.textContent = t('key.copied');
            },
          },
        }),
      ]),
      el('h3', { text: t('key.confirm.title') }),
      el('label', { className: 'inline', attrs: { for: 'backup-confirm' } }, [
        confirmed,
        el('span', { text: t('key.confirm.checkbox') }),
      ]),
      feedback,
      el('button', {
        className: 'primary backup-continue',
        text: t('key.backup.continue'),
        on: {
          click: () => this.run(async () => {
            if (!confirmed.checked) {
              feedback.textContent = t('key.confirm.unchecked');
              throw new Error(t('key.confirm.unchecked'));
            }
            feedback.textContent = t('key.confirm.done');
            this.pendingKey = null;
            await this.use(createLocalSigner(this.session), 'local');
          }),
        },
      }),
      el('button', { className: 'quiet backup-back', text: t('key.choice.change'), on: { click: () => this.navigateBack() } }),
    ]));
  }

  renderEncryptedSetup() {
    const { t } = this;
    const pass = el('input', { attrs: { type: 'password', id: 'new-pass', autocomplete: 'new-password' } });
    const repeat = el('input', { attrs: { type: 'password', id: 'repeat-pass', autocomplete: 'new-password' } });
    replace(this.mount, el('div', { className: 'card' }, [
      el('h2', { text: t('key.encrypted.create.title') }),
      el('p', { className: 'small', text: t('key.encrypted.create.hint') }),
      this.error ? el('div', { className: 'notice bad' }, [el('p', { text: this.error })]) : null,
      el('label', { attrs: { for: 'new-pass' } }, [
        el('span', { text: t('signin.passphrase') }),
        el('span', { className: 'hint', text: t('key.encrypted.passphrase.hint') }),
        pass,
      ]),
      el('label', { attrs: { for: 'repeat-pass' } }, [el('span', { text: t('key.encrypted.repeat') }), repeat]),
      el('div', { className: 'row' }, [
        el('button', {
          className: 'primary',
          text: t('key.encrypted.create.action'),
          on: {
            click: () => this.run(async () => {
              if (pass.value !== repeat.value) throw new Error(t('key.encrypted.mismatch'));
              this.pendingNcryptsec = await this.session.createNcryptsec(pass.value);
              pass.value = ''; repeat.value = '';
              this.navigate('new-backup-encrypted-ready');
            }),
          },
        }),
        el('button', {
          className: 'quiet backup-back',
          text: t('key.choice.change'),
          on: { click: () => this.navigateBack() },
        }),
      ]),
    ]));
  }

  renderEncryptedBackup() {
    const { t } = this;
    const value = this.pendingNcryptsec;
    const canStore = Boolean(this.session.storage);
    const confirmed = el('input', { attrs: { type: 'checkbox', id: 'backup-confirm' } });
    const feedback = el('p', { className: 'small', attrs: { role: 'status', 'aria-live': 'polite' } });
    const download = () => {
      const blob = new Blob([`${value}\n`], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'cruxcoach-identity-backup.ncryptsec';
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      feedback.textContent = t('key.encrypted.downloaded');
    };
    replace(this.mount, el('div', { className: 'card' }, [
      el('h2', { text: t('key.encrypted.ready.title') }),
      el('p', { className: 'lede', text: t('key.encrypted.ready.hint') }),
      el('div', { className: 'notice' }, [el('p', { text: t('key.encrypted.separate') })]),
      !canStore ? el('div', { className: 'notice warn' }, [
        el('p', { text: t('key.encrypted.storage.unavailable') }),
      ]) : null,
      el('div', { className: 'secret encrypted-secret', text: 'ncryptsec1••••••••••••••••••••' }),
      el('div', { className: 'row' }, [
        el('button', { className: 'primary', text: t('key.encrypted.download'), on: { click: download } }),
        el('button', { text: t('key.encrypted.copy'), on: { click: async () => {
          await copyWithExpiry(value); feedback.textContent = t('key.copied');
        } } }),
      ]),
      el('label', { className: 'inline', attrs: { for: 'backup-confirm' } }, [
        confirmed, el('span', { text: t('key.encrypted.confirm') }),
      ]),
      feedback,
      el('button', { className: 'primary backup-continue', text: t(canStore ? 'key.encrypted.continue' : 'key.backup.continue'), on: {
        click: () => this.run(async () => {
          if (!confirmed.checked) throw new Error(t('key.confirm.unchecked'));
          this.session.saveNcryptsec(value);
          this.pendingNcryptsec = null; this.pendingKey = null;
          await this.use(createLocalSigner(this.session), 'local');
        }),
      } }),
      el('button', { className: 'quiet backup-back', text: t('signin.choice.back'), on: { click: () => this.navigateBack() } }),
    ]));
  }

  /**
   * Try to restore a previous session without prompting.
   *
   * Extensions, live bunker connections, and still-valid tab-local key
   * sessions restore silently. The durable credentials remain encrypted.
   */
  async restore() {
    const method = this.storedMethod();
    if (method === 'local' && this.session.hasStoredKey()
      && await this.session.restoreAfterReload()) {
      await this.use(createLocalSigner(this.session), 'local');
      return;
    }
    if (method === 'nip46') {
      const live = this.remoteSession.resumeLive();
      if (live) {
        try {
          const signer = await createNip46Signer(buildResumeUri(live.connection), {
            clientSecret: live.secretKey,
            resume: true,
            expectedUserPubkey: live.connection.user_pubkey,
            touchClient: () => this.remoteSession.touch(),
          });
          await this.use(signer, 'nip46');
          return;
        } catch {
          // Keep the tab credential: an asleep signer or offline relay is
          // retryable and must not silently destroy an otherwise valid session.
          this.remoteSession.lock();
        }
      }
    }
    // A reload must feel like returning, not like registration. Local and
    // remote credentials remain encrypted and still require their passphrase;
    // we simply open the correct unlock screen immediately.
    if (method === 'local' && this.session.hasStoredKey()) {
      this.entryMode = 'existing';
      this.render();
      return;
    }
    if (method === 'nip46' && this.remoteSession.hasStoredConnection()) {
      this.entryMode = 'existing';
      this.render();
      return;
    }
    if (method !== 'nip07') {
      const screen = this.navigationScreen();
      this.entryMode = entryModeForScreen(BACKUP_SCREENS.has(screen) ? 'new' : screen);
      this.render();
      return;
    }
    const extension = await waitForNip07();
    if (!extension) { this.render(); return; }
    try {
      await this.use(await createNip07Signer(), 'nip07');
    } catch {
      this.render();
    }
  }
}

export { npubEncode, nsecEncode };
