/**
 * The mandatory kind-0 gate.
 *
 * Signing in proves you hold a key. It does not give you a name, and a
 * competition is a public thing with named people in it — a leaderboard that is
 * a column of hex helps nobody, and an organizer publishing a public event
 * should have an identity somebody can look up.
 *
 * So: after any of the three signer paths, this fetches the newest kind 0 for
 * that pubkey across the configured relays and verifies it. A returning user
 * with a usable profile passes straight through. Anyone else fills in a short
 * form and must successfully PUBLISH a signed kind 0 before create, register,
 * check-in or any other write unlocks.
 *
 * Nothing here is a local flag: the gate is satisfied by an event that at least
 * one relay accepted, because a profile only exists if others can read it.
 */
import {
  buildProfileEvent, competitionDisplayName, selectNewestProfile, validateProfileFields, PROFILE_KIND,
} from '../protocol/profile.mjs';
import { announce, el, replace } from './dom.mjs';

/** Outcomes the caller can act on, rather than a boolean. */
export const GateState = {
  CHECKING: 'checking',
  READY: 'ready',
  NEEDS_PROFILE: 'needs_profile',
  UNREACHABLE: 'unreachable',
};

/**
 * Fetch and verify the current profile for `pubkey`.
 *
 * @returns {Promise<{state: string, profile?: object, invalid?: string, conflicting?: boolean}>}
 */
export async function fetchProfile(pool, pubkey, { timeoutMs = 6000 } = {}) {
  const { events, complete } = await pool.query(
    [{ kinds: [PROFILE_KIND], authors: [pubkey], limit: 8 }],
    { timeoutMs },
  );
  const selected = await selectNewestProfile(events, pubkey);

  if (!selected.found) {
    // "No relay answered" and "the relays answered and you have no profile" are
    // different problems: one is a network to retry, the other is a form to
    // fill in. Treating a timeout as "you have no profile" would invite someone
    // to overwrite a profile they already have.
    return { state: complete ? GateState.NEEDS_PROFILE : GateState.UNREACHABLE };
  }
  if (selected.invalid) {
    return { state: GateState.NEEDS_PROFILE, invalid: selected.invalid, conflicting: selected.conflicting };
  }
  if (!selected.profile.complete) {
    return { state: GateState.NEEDS_PROFILE, profile: selected.profile, conflicting: selected.conflicting };
  }
  return { state: GateState.READY, profile: selected.profile, conflicting: selected.conflicting };
}

/**
 * Publish a profile and confirm at least one relay took it.
 *
 * `accepted === 0` is a failure, not a warning. A profile nobody stores is a
 * profile nobody can read, and letting the gate pass on it would produce
 * exactly the nameless leaderboard the gate exists to prevent.
 */
export async function publishProfile(pool, signer, fields, existingRaw, now = Math.floor(Date.now() / 1000)) {
  const draft = buildProfileEvent(fields, now, existingRaw);
  const event = await signer.signEvent(draft);
  const result = await pool.publish(event);
  if (result.accepted === 0) {
    const error = new Error('no_relay');
    error.attempted = result.attempted;
    throw error;
  }
  return { event, ...result };
}

/**
 * The gate as a screen.
 *
 * Owns its own DOM node; the caller mounts it and waits for `onReady`.
 */
export class ProfileGate {
  /**
   * @param {object} options
   * @param {(key: string, values?: object) => string} options.t
   * @param {HTMLElement} options.mount
   * @param {import('../protocol/relay-pool.mjs').RelayPool} options.pool
   * @param {(profile: object) => void} options.onReady
   * @param {() => void} options.onCancel  called when the user backs out; the
   *   caller must sign out, because a signed-in user with no profile has no
   *   capabilities and a screen offering none is confusing.
   */
  constructor({ t, mount, pool, onReady, onCancel }) {
    this.t = t;
    this.mount = mount;
    this.pool = pool;
    this.onReady = onReady;
    this.onCancel = onCancel;
    this.signer = null;
    this.state = GateState.CHECKING;
    this.profile = null;
    this.invalid = null;
    this.conflicting = false;
    this.error = null;
    this.busy = false;
  }

  get ready() {
    return this.state === GateState.READY && Boolean(this.profile);
  }

  /** The name a competition should use, never contact details. */
  get displayName() {
    return competitionDisplayName(this.profile, this.signer?.pubkey);
  }

  async check(signer) {
    this.signer = signer;
    this.state = GateState.CHECKING;
    this.error = null;
    this.render();
    try {
      const result = await fetchProfile(this.pool, signer.pubkey);
      this.state = result.state;
      this.profile = result.profile || null;
      this.invalid = result.invalid || null;
      this.conflicting = Boolean(result.conflicting);
    } catch (err) {
      this.state = GateState.UNREACHABLE;
      this.error = err.message;
    }
    this.render();
    if (this.ready) this.onReady(this.profile);
    return this.state;
  }

  reset() {
    this.signer = null;
    this.profile = null;
    this.state = GateState.CHECKING;
    this.invalid = null;
    this.conflicting = false;
    this.error = null;
    replace(this.mount);
  }

  render() {
    const { t } = this;
    if (!this.signer) { replace(this.mount); return; }

    if (this.state === GateState.CHECKING) {
      replace(this.mount, el('div', { className: 'card' }, [
        el('p', { attrs: { role: 'status', 'aria-live': 'polite' }, text: t('profile.checking') }),
      ]));
      return;
    }

    if (this.state === GateState.UNREACHABLE) {
      replace(this.mount, el('div', { className: 'card' }, [
        el('h2', { text: t('profile.title') }),
        el('div', { className: 'notice bad', attrs: { role: 'alert' } }, [
          el('p', { text: t('profile.unreachable') }),
        ]),
        el('div', { className: 'row' }, [
          el('button', {
            className: 'primary',
            text: t('action.retry'),
            on: { click: () => this.check(this.signer) },
          }),
          el('button', { text: t('signin.out'), on: { click: () => this.onCancel() } }),
        ]),
      ]));
      return;
    }

    if (this.state === GateState.READY) {
      replace(this.mount, el('div', { className: 'card' }, [
        el('div', { className: 'row between' }, [
          el('div', {}, [
            el('div', { className: 'small', text: t('profile.signed_in_as') }),
            el('div', { text: this.displayName }),
          ]),
          el('button', {
            className: 'quiet',
            text: t('profile.edit'),
            on: {
              click: () => {
                this.state = GateState.NEEDS_PROFILE;
                this.render();
              },
            },
          }),
        ]),
        this.conflicting
          ? el('p', { className: 'small', text: t('profile.conflicting') })
          : null,
      ]));
      return;
    }

    this.renderForm();
  }

  renderForm() {
    const { t } = this;
    const existing = this.profile?.fields || {};
    const inputs = {
      name: el('input', {
        attrs: {
          type: 'text', id: 'profile-name', maxlength: '48', required: 'required',
          autocomplete: 'nickname', value: existing.name || existing.display_name || '',
        },
      }),
      about: el('textarea', { attrs: { id: 'profile-about', maxlength: '500' } }),
      picture: el('input', {
        attrs: { type: 'text', id: 'profile-picture', maxlength: '512', inputmode: 'url', value: existing.picture || '' },
      }),
      lud16: el('input', {
        attrs: { type: 'text', id: 'profile-lud16', maxlength: '128', value: existing.lud16 || '' },
      }),
    };
    inputs.about.value = existing.about || '';

    const errors = el('div', { attrs: { role: 'alert' } });
    const status = el('p', { className: 'small', attrs: { role: 'status', 'aria-live': 'polite' } });

    const notices = [];
    if (this.invalid === 'invalid_json') {
      notices.push(el('div', { className: 'notice warn' }, [el('p', { text: t('profile.broken') })]));
    } else if (this.invalid) {
      notices.push(el('div', { className: 'notice warn' }, [el('p', { text: t('profile.unreadable') })]));
    }
    if (this.conflicting) {
      notices.push(el('div', { className: 'notice warn' }, [el('p', { text: t('profile.conflicting') })]));
    }

    replace(this.mount, el('div', { className: 'card' }, [
      el('h2', { text: t('profile.title') }),
      el('p', { text: t('profile.why') }),
      el('div', { className: 'notice' }, [el('p', { text: t('profile.public') })]),
      ...notices,
      el('label', { attrs: { for: 'profile-name' } }, [
        el('span', { text: t('profile.name') }),
        el('span', { className: 'hint', text: t('profile.name.hint') }),
        inputs.name,
      ]),
      el('details', { className: 'disclosure' }, [
        el('summary', { text: t('profile.optional') }),
        el('label', { attrs: { for: 'profile-about' }, text: t('profile.about') }, [inputs.about]),
        el('label', { attrs: { for: 'profile-picture' } }, [
          el('span', { text: t('profile.picture') }),
          el('span', { className: 'hint', text: t('profile.picture.hint') }),
          inputs.picture,
        ]),
        el('label', { attrs: { for: 'profile-lud16' } }, [
          el('span', { text: t('profile.lud16') }),
          el('span', { className: 'hint', text: t('profile.lud16.hint') }),
          inputs.lud16,
        ]),
      ]),
      errors,
      status,
      el('div', { className: 'row' }, [
        el('button', {
          className: 'primary',
          text: t('profile.save'),
          attrs: { disabled: this.busy },
          on: {
            click: async () => {
              replace(errors);
              const fields = {
                name: inputs.name.value,
                about: inputs.about.value,
                picture: inputs.picture.value,
                lud16: inputs.lud16.value,
              };
              const validation = validateProfileFields(fields);
              if (!validation.ok) {
                replace(errors, el('div', { className: 'notice bad' }, [
                  el('ul', { className: 'plain' }, validation.errors.map(
                    (e) => el('li', { text: `${t(`profile.${e.field}`)} ${e.message}` }),
                  )),
                ]));
                announce(t('profile.invalid'), { assertive: true });
                return;
              }
              this.busy = true;
              status.textContent = t('profile.saving');
              try {
                const published = await publishProfile(
                  this.pool, this.signer, fields, this.profile?.raw || {},
                );
                status.textContent = t('publish.ok', published);
                // Re-read rather than trusting the write: the gate is satisfied
                // by a profile a relay will hand back, not by one we sent.
                await this.check(this.signer);
              } catch (err) {
                this.busy = false;
                replace(errors, el('div', { className: 'notice bad' }, [
                  el('p', { text: err.message === 'no_relay' ? t('publish.none') : t('profile.failed') }),
                ]));
                announce(t('profile.failed'), { assertive: true });
              }
            },
          },
        }),
        el('button', {
          text: t('signin.out'),
          on: { click: () => this.onCancel() },
        }),
      ]),
    ]));
  }
}
