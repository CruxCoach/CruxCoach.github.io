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
import { KeyVaultSession, backupChallenge, checkBackupChallenge } from '../signer/local-key.mjs';
import {
  createLocalSigner, createNip07Signer, createNip46Signer, waitForNip07,
} from '../signer/signers.mjs';
import { nsecEncode, npubEncode } from '../protocol/nostr-event.mjs';
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
    this.sharedDevice = false;
    this.pendingKey = null;
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
   * For a NIP-46 bunker this closes the local session only. NIP-46 has no
   * revoke a client can rely on, so the honest thing is to say that the
   * approval lives in the signer app and is revoked there.
   */
  signOut() {
    this.signer?.close();
    this.signer = null;
    this.profile = null;
    this.gate?.reset();
    this.session.lock();
    try { localStorage.removeItem(METHOD_KEY); } catch { /* private mode */ }
    this.render();
    this.onChange(null, null);
  }

  /** Remove the stored key from this device. Irreversible, so it confirms. */
  forgetKey() {
    if (!confirm(this.t('signin.forget.confirm'))) return;
    this.signer?.close();
    this.signer = null;
    this.profile = null;
    this.gate?.reset();
    this.session.forget();
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
      this.error = err.message || String(err);
      announce(this.error, { assertive: true });
    } finally {
      this.busy = false;
      this.render();
    }
  }

  render() {
    const { t } = this;
    if (this.signer) {
      replace(this.mount, el('div', { className: 'card' }, [
        el('div', { className: 'row between' }, [
          el('div', {}, [
            el('div', { className: 'small', text: t('signin.as') }),
            el('div', { text: this.displayName }),
            el('div', { className: 'small mono', text: shortKey(this.signer.pubkey) }),
            el('div', { className: 'small', text: this.signer.kind }),
          ]),
          el('span', { className: 'row' }, [
            el('button', { text: t('signin.out'), on: { click: () => this.signOut() } }),
            // Only for a key this device is actually holding. Signing out of an
            // extension or a bunker leaves nothing here to forget.
            this.session?.hasStoredKey?.() ? el('button', {
              className: 'danger',
              text: t('signin.forget'),
              on: { click: () => this.forgetKey() },
            }) : null,
          ]),
        ]),
        el('p', { className: 'small', text: t('signin.out.hint') }),
        this.ready ? null : el('p', { className: 'small', text: t('profile.required') }),
      ]));
      return;
    }

    if (this.pendingKey) { this.renderBackup(); return; }

    const children = [el('h2', { text: t('signin.title') }), el('p', { text: t('signin.intro') })];
    if (this.error) children.push(el('div', { className: 'notice bad' }, [el('p', { text: this.error })]));
    if (this.busy) children.push(el('p', { className: 'small', text: t('signin.working') }));

    // 1. extension
    children.push(el('div', { className: 'card raised' }, [
      el('h3', { text: t('signin.extension') }),
      el('p', { className: 'small', text: t('signin.extension.hint') }),
      el('button', {
        className: 'primary',
        text: t('signin.extension'),
        attrs: { disabled: this.busy },
        on: { click: () => this.run(async () => this.use(await createNip07Signer(), 'nip07')) },
      }),
    ]));

    // 2. remote signer
    const bunkerInput = el('input', {
      attrs: { type: 'text', placeholder: t('signin.bunker.placeholder'), id: 'bunker-uri', autocomplete: 'off', spellcheck: 'false' },
    });
    children.push(el('div', { className: 'card raised' }, [
      el('h3', { text: t('signin.bunker') }),
      el('p', { className: 'small', text: t('signin.bunker.hint') }),
      el('label', { attrs: { for: 'bunker-uri' }, text: t('signin.bunker') }, [bunkerInput]),
      el('button', {
        text: t('signin.bunker.connect'),
        attrs: { disabled: this.busy },
        on: {
          click: () => this.run(async () => {
            const signer = await createNip46Signer(bunkerInput.value.trim());
            await this.use(signer, 'nip46');
          }),
        },
      }),
    ]));

    // 3. a key made here — offered last, and only with the trade-off stated
    const localChildren = [
      el('h3', { text: t('signin.local') }),
      el('p', { className: 'small', text: t('signin.local.hint') }),
    ];
    if (this.session.hasStoredKey()) {
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
    } else {
      const shared = el('input', {
        attrs: { type: 'checkbox', id: 'shared-device' },
        on: { change: (event) => { this.sharedDevice = event.target.checked; } },
      });
      localChildren.push(
        el('label', { className: 'inline', attrs: { for: 'shared-device' } }, [
          shared,
          el('span', {}, [
            el('span', { text: t('signin.shared') }),
            el('span', { className: 'hint', text: t('signin.shared.hint') }),
          ]),
        ]),
        el('button', {
          text: t('signin.local'),
          attrs: { disabled: this.busy },
          on: {
            click: () => this.run(async () => {
              this.session = new KeyVaultSession(this.sharedDevice ? { storage: null } : {});
              this.pendingKey = this.session.generate();
              this.render();
            }),
          },
        }),
      );
    }
    children.push(el('div', { className: 'card raised' }, localChildren));

    replace(this.mount, el('div', { className: 'card' }, children));
  }

  /**
   * The backup step.
   *
   * It asks for three specific characters of the nsec rather than accepting a
   * tick box, because "I have written it down" is the assertion people make
   * right before they lose the only copy.
   */
  renderBackup() {
    const { t } = this;
    const nsec = this.pendingKey.nsec;
    const challenge = backupChallenge(nsec);
    const inputs = challenge.map((item, index) => el('input', {
      attrs: {
        type: 'text', maxlength: '1', inputmode: 'text', autocomplete: 'off',
        id: `challenge-${index}`, 'aria-label': t('key.confirm.position', { n: item.position }),
      },
    }));
    const feedback = el('p', { className: 'small', attrs: { role: 'status', 'aria-live': 'polite' } });

    replace(this.mount, el('div', { className: 'card' }, [
      el('h2', { text: t('key.generated') }),
      el('div', { className: 'notice warn' }, [el('p', { text: t('key.warning') })]),
      el('p', { className: 'small', attrs: { id: 'nsec-warning' }, text: t('key.warning') }),
      el('div', { className: 'secret', attrs: { role: 'text', 'aria-describedby': 'nsec-warning' }, text: nsec }),
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
      el('p', { text: t('key.confirm.intro') }),
      el('div', { className: 'challenge' }, challenge.map((item, index) => el('label', {
        attrs: { for: `challenge-${index}` },
        text: t('key.confirm.position', { n: item.position }),
      }, [inputs[index]]))),
      feedback,
      el('button', {
        className: 'primary',
        text: t('action.save'),
        on: {
          click: () => this.run(async () => {
            if (!checkBackupChallenge(challenge, inputs.map((input) => input.value))) {
              feedback.textContent = t('key.confirm.wrong');
              throw new Error(t('key.confirm.wrong'));
            }
            feedback.textContent = t('key.confirm.done');
            this.pendingKey = null;
            if (this.session.storage) {
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
      el('label', { attrs: { for: 'new-pass' } }, [
        el('span', { text: t('signin.passphrase') }),
        el('span', { className: 'hint', text: t('signin.passphrase.hint') }),
        pass,
      ]),
      el('div', { className: 'row' }, [
        el('button', {
          className: 'primary',
          text: t('action.save'),
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
          text: t('action.cancel'),
          on: { click: () => this.run(async () => this.use(createLocalSigner(this.session), 'local')) },
        }),
      ]),
    ]));
  }

  /**
   * Try to restore a previous session without prompting.
   *
   * Only the extension path can be restored silently — it is the only one where
   * nothing secret has to be unlocked. A bunker needs its URI again and a local
   * key needs its passphrase, and pretending otherwise would mean keeping
   * something we should not.
   */
  async restore() {
    if (this.storedMethod() !== 'nip07') { this.render(); return; }
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
