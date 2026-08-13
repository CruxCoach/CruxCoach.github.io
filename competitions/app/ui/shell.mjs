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
import { KeyVaultSession } from '../signer/local-key.mjs';
import {
  createLocalSigner, createNip07Signer, createNip46Signer, parseNip46Uri, waitForNip07,
} from '../signer/signers.mjs';
import { Nip46ConnectionSession, buildResumeUri } from '../signer/nip46-connection.mjs';
import { generateSecretKey, nsecEncode, npubEncode } from '../protocol/nostr-event.mjs';
import { el, replace, copyWithExpiry, shortKey, announce } from './dom.mjs';
import { ProfileGate } from './profile-gate.mjs';

const METHOD_KEY = 'cruxcoach:competitions:method:v1';

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
    this.pendingLocalPersist = false;
    this.pendingNip46 = null;
    this.error = null;
    this.busy = false;
    this.profile = null;
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
      this.pendingKey = null;
      this.pendingLocalPersist = false;
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
    this.entryMode = null;
    this.pendingLocalPersist = false;
    try { localStorage.removeItem(METHOD_KEY); } catch { /* private mode */ }
    this.render();
    this.onChange(null, null);
  }

  /** Revoke the paired client where supported, then erase its encrypted credential. */
  async forgetNip46() {
    if (!confirm(this.t('signin.bunker.remove.confirm'))) return;
    if (this.signer?.kind === 'nip46') {
      try { await this.signer.logout?.(); } catch { this.signer.close(); }
      this.signer = null;
    }
    this.pendingNip46?.close?.();
    this.pendingNip46 = null;
    this.profile = null;
    this.gate?.reset();
    this.remoteSession.forget();
    this.entryMode = null;
    this.pendingLocalPersist = false;
    try { localStorage.removeItem(METHOD_KEY); } catch { /* private mode */ }
    this.render();
    this.onChange(null, null);
    announce(this.t('signin.bunker.remove.done'));
  }

  /** Remove the stored key from this device. Irreversible, so it confirms. */
  forgetKey() {
    if (!confirm(this.t('signin.forget.confirm'))) return;
    this.signer?.close();
    this.signer = null;
    this.profile = null;
    this.gate?.reset();
    this.session.forget();
    this.entryMode = null;
    this.pendingLocalPersist = false;
    try { localStorage.removeItem(METHOD_KEY); } catch { /* private mode */ }
    this.render();
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
              on: { click: () => this.forgetKey() },
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
    if (this.pendingLocalPersist) { this.renderPersist(); return; }
    if (this.pendingNip46) { this.renderNip46Persist(); return; }

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
            on: { click: () => { this.entryMode = 'new'; this.render(); } },
          }, [
            el('strong', { text: t('signin.choice.new') }),
            el('span', { className: 'small', text: t('signin.choice.new.hint') }),
          ]),
          el('button', {
            className: 'signin-choice',
            attrs: { type: 'button' },
            on: { click: () => { this.entryMode = 'existing'; this.render(); } },
          }, [
            el('strong', { text: t('signin.choice.existing') }),
            el('span', { className: 'small', text: t('signin.choice.existing.hint') }),
          ]),
        ]),
      );
      replace(this.mount, el('div', { className: 'card' }, children));
      return;
    }

    children.push(el('div', { className: 'row between signin-path-heading' }, [
      el('h3', { text: t(this.entryMode === 'new' ? 'signin.new.title' : 'signin.existing.title') }),
      el('button', {
        className: 'quiet', text: t('signin.choice.back'),
        on: { click: () => { this.entryMode = null; this.error = null; this.render(); } },
      }),
    ]));

    const alternativeMethods = [el('div', { className: 'card raised' }, [
      el('h3', { text: t('signin.extension') }),
      el('p', { className: 'small', text: t('signin.extension.hint') }),
      el('button', {
        className: 'primary',
        text: t('signin.extension'),
        attrs: { disabled: this.busy },
        on: { click: () => this.run(async () => this.use(await createNip07Signer(), 'nip07')) },
      }),
    ])];

    // 2. remote signer
    const remoteChildren = [
      el('h3', { text: t('signin.bunker') }),
      el('p', { className: 'small', text: t('signin.bunker.hint') }),
    ];
    const savedRemote = this.remoteSession.describe();
    if (this.remoteSession.hasStoredConnection() && savedRemote) {
      const pass = el('input', { attrs: { type: 'password', id: 'bunker-pass', autocomplete: 'current-password' } });
      remoteChildren.push(
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
      );
    } else {
      const bunkerInput = el('input', {
        attrs: { type: 'text', placeholder: t('signin.bunker.placeholder'), id: 'bunker-uri', autocomplete: 'off', spellcheck: 'false' },
      });
      remoteChildren.push(
        el('label', { attrs: { for: 'bunker-uri' }, text: t('signin.bunker') }, [bunkerInput]),
        el('button', {
          text: t('signin.bunker.connect'),
          attrs: { disabled: this.busy },
          on: {
            click: () => this.run(async () => {
              const uri = bunkerInput.value.trim();
              if (parseNip46Uri(uri)?.scheme !== 'bunker') throw new Error(t('signin.bunker.only_bunker'));
              this.remoteSession.adopt(generateSecretKey());
              try {
                this.pendingNip46 = await createNip46Signer(uri, {
                  clientSecret: this.remoteSession.secretKey,
                  touchClient: () => this.remoteSession.touch(),
                });
              } catch (error) {
                this.remoteSession.lock();
                throw error;
              }
            }),
          },
        }),
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
          on: {
            click: () => {
              if (!confirm(t('key.forget.confirm'))) return;
              this.session.forget();
              this.render();
            },
          },
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
              this.pendingLocalPersist = false;
              this.pendingKey = this.session.generate();
              this.render();
            }),
          },
        }),
      );

    }

    // Import is deliberately session-only. It must not turn pasting a
    // high-value secret into an implicit persistence decision.
    if (this.entryMode === 'existing') {
      const importedNsec = el('input', {
        attrs: {
          type: 'password', id: 'import-nsec', autocomplete: 'off',
          autocapitalize: 'none', spellcheck: 'false', placeholder: t('signin.import.placeholder'),
        },
      });
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
        importFeedback,
        el('button', {
          text: t('signin.import.action'),
          attrs: { disabled: this.busy },
          on: {
            click: () => this.run(async () => {
              try {
                const session = new KeyVaultSession({ storage: null });
                session.importKey(importedNsec.value);
                importedNsec.value = '';
                this.session = session;
                await this.use(createLocalSigner(session), 'local');
              } catch (err) {
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
      children.push(el('div', { className: 'card raised' }, localChildren));
    } else {
      if (this.session.hasStoredKey()) alternativeMethods.unshift(el('div', { className: 'card raised' }, localChildren));
      children.push(...alternativeMethods);
    }

    replace(this.mount, el('div', { className: 'card' }, children));
  }

  /** Save the approved NIP-46 client credential, never the one-time invitation secret. */
  renderNip46Persist() {
    const { t } = this;
    const signer = this.pendingNip46;
    const pass = el('input', { attrs: { type: 'password', id: 'bunker-new-pass', autocomplete: 'new-password' } });
    replace(this.mount, el('div', { className: 'card' }, [
      el('h2', { text: t('signin.bunker.save.title') }),
      el('p', { className: 'small', text: t('signin.bunker.save.hint') }),
      this.error ? el('div', { className: 'notice bad' }, [el('p', { text: this.error })]) : null,
      el('label', { attrs: { for: 'bunker-new-pass' } }, [
        el('span', { text: t('signin.passphrase') }),
        el('span', { className: 'hint', text: t('signin.passphrase.hint') }),
        pass,
      ]),
      el('div', { className: 'row' }, [
        el('button', {
          className: 'primary', text: t('signin.bunker.save.action'), attrs: { disabled: this.busy },
          on: {
            click: () => this.run(async () => {
              await this.remoteSession.persist({
                remoteSignerPubkey: signer.remoteSignerPubkey,
                userPubkey: signer.pubkey,
                relays: signer.relays,
              }, pass.value);
              pass.value = '';
              this.pendingNip46 = null;
              await this.use(signer, 'nip46');
            }),
          },
        }),
        el('button', {
          className: 'quiet', text: t('signin.bunker.once'), attrs: { disabled: this.busy },
          on: {
            click: () => this.run(async () => {
              this.pendingNip46 = null;
              await this.use(signer, 'nip46');
            }),
          },
        }),
      ]),
      el('p', { className: 'small', text: t('signin.bunker.once.hint') }),
    ]));
  }

  /**
   * The backup step.
   *
   * A tick box, deliberately. This screen shows the nsec a few lines further
   * up, so asking for three characters of it proved only that somebody can
   * read the page in front of them — friction shaped like a check without
   * being one. A character challenge is worth something only where the key is
   * no longer on screen; here an honest confirmation beats a false test.
   */
  renderBackup() {
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
      el('h2', { text: t('key.generated') }),
      el('div', { className: 'notice warn', attrs: { id: 'nsec-warning' } }, [
        el('p', { text: t('key.warning') }),
      ]),
      el('ul', { className: 'key-practices' }, [
        el('li', { text: t('key.practice.password_manager') }),
        el('li', { text: t('key.practice.protect_manager') }),
        el('li', { text: t('key.practice.private') }),
        el('li', { text: t('key.practice.verify') }),
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
      el('details', { className: 'disclosure signer-backup-help' }, [
        el('summary', { text: t('key.signer.title') }),
        el('p', {
          className: 'small',
          text: t(globalThis.window?.nostr ? 'key.signer.detected' : 'key.signer.hint'),
        }),
        el('div', { className: 'row' }, [
          el('a', {
            className: 'button', text: t('key.signer.chrome'),
            attrs: {
              href: 'https://chromewebstore.google.com/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp',
              target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer',
            },
          }),
          el('a', {
            className: 'button', text: t('key.signer.firefox'),
            attrs: {
              href: 'https://addons.mozilla.org/firefox/addon/nos2x-fox/',
              target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer',
            },
          }),
        ]),
      ]),
      el('h3', { text: t('key.confirm.title') }),
      el('label', { className: 'inline', attrs: { for: 'backup-confirm' } }, [
        confirmed,
        el('span', { text: t('key.confirm.checkbox') }),
      ]),
      feedback,
      el('button', {
        className: 'primary',
        text: t('key.backup.continue'),
        on: {
          click: () => this.run(async () => {
            if (!confirmed.checked) {
              feedback.textContent = t('key.confirm.unchecked');
              throw new Error(t('key.confirm.unchecked'));
            }
            feedback.textContent = t('key.confirm.done');
            this.pendingKey = null;
            if (this.session.storage) {
              this.pendingLocalPersist = true;
              this.renderPersist();
            } else {
              await this.use(createLocalSigner(this.session), 'local');
            }
          }),
        },
      }),
    ]));
  }

  renderPersist() {
    const { t } = this;
    const pass = el('input', { attrs: { type: 'password', id: 'new-pass', autocomplete: 'new-password' } });
    replace(this.mount, el('div', { className: 'card' }, [
      el('h2', { text: t('key.save.title') }),
      el('p', { className: 'small', text: t('key.save.hint') }),
      this.error ? el('div', { className: 'notice bad' }, [el('p', { text: this.error })]) : null,
      el('label', { attrs: { for: 'new-pass' } }, [
        el('span', { text: t('signin.passphrase') }),
        el('span', { className: 'hint', text: t('signin.passphrase.hint') }),
        pass,
      ]),
      el('div', { className: 'row' }, [
        el('button', {
          className: 'primary',
          text: t('key.save.continue'),
          on: {
            click: () => this.run(async () => {
              await this.session.persist(pass.value);
              pass.value = '';
              await this.use(createLocalSigner(this.session), 'local');
            }),
          },
        }),
        el('button', {
          className: 'quiet',
          text: t('key.save.skip'),
          on: { click: () => this.run(async () => this.use(createLocalSigner(this.session), 'local')) },
        }),
      ]),
    ]));
  }

  /**
   * Try to restore a previous session without prompting.
   *
   * Only the extension path can be restored silently — it is the only one where
   * nothing secret has to be unlocked. A saved bunker pairing and a local key
   * instead render their passphrase unlock control.
   */
  async restore() {
    const method = this.storedMethod();
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
    if (method !== 'nip07') { this.render(); return; }
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
