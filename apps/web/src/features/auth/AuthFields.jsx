// Form controls for the sign-in pages, styled by auth.css. Labels sit above the field; hints and
// errors are wired to the input for assistive technology. On focus, a carbon plate slides into
// register with the field's edge: the same registration the table beside the form shows.
import { useId, useState } from 'react';
import { CircleAlert, ArrowBigUp } from 'lucide-react';

function Described({ id, hint, error, extra }) {
  return (
    <>
      {extra}
      {error ? (
        <p id={`${id}-error`} className="ss-auth-error">
          <CircleAlert aria-hidden="true" size={16} strokeWidth={2.25} />
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="ss-auth-hint">
            {hint}
          </p>
        )
      )}
    </>
  );
}

function describedBy(id, { hint, error, more = [] }) {
  return [error ? `${id}-error` : hint ? `${id}-hint` : null, ...more].filter(Boolean).join(' ') || undefined;
}

/**
 * @param {{ label: string, hint?: React.ReactNode, error?: string | null, name: string }} props
 *   name: also the field's view-transition name, so it keeps its place between the two pages.
 */
export function AuthField({ label, hint, error, name, ...input }) {
  const id = useId();
  return (
    <div className="ss-auth-field" style={{ viewTransitionName: `auth-field-${name}` }}>
      <label htmlFor={id} className="ss-auth-label">
        {label}
      </label>
      <div className="ss-auth-control">
        <input
          id={id}
          name={name}
          className="ss-auth-input"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy(id, { hint, error })}
          {...input}
        />
      </div>
      <Described id={id} hint={hint} error={error} />
    </div>
  );
}

/**
 * A password field with a show/hide switch and a Caps Lock warning.
 * @param {{ minLength?: number }} props  minLength: shows a rule of ticks filling to that length.
 */
export function PasswordField({ label = 'Password', hint, error, minLength, value, onChange, ...input }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const checkCaps = (event) => setCapsLock(Boolean(event.getModifierState?.('CapsLock')));
  const met = minLength ? value.length >= minLength : false;

  const rule = minLength ? (
    <div className="ss-auth-rule" aria-hidden="true" data-met={met || undefined}>
      {Array.from({ length: minLength }, (_, index) => (
        <span key={index} data-on={index < value.length || undefined} />
      ))}
    </div>
  ) : null;

  return (
    <div className="ss-auth-field" style={{ viewTransitionName: 'auth-field-password' }}>
      <label htmlFor={id} className="ss-auth-label">
        {label}
      </label>
      <div className="ss-auth-control ss-auth-control--password">
        <input
          id={id}
          name="password"
          type={visible ? 'text' : 'password'}
          className="ss-auth-input"
          value={value}
          onChange={onChange}
          onKeyDown={checkCaps}
          onKeyUp={checkCaps}
          onBlur={() => setCapsLock(false)}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy(id, { hint, error, more: capsLock ? [`${id}-caps`] : [] })}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          {...input}
        />
        <button type="button" className="ss-auth-reveal" aria-controls={id} onClick={() => setVisible((current) => !current)}>
          {visible ? 'Hide' : 'Show'}
          <span className="ss-auth-visually-hidden"> password</span>
        </button>
      </div>
      <Described
        id={id}
        hint={hint}
        error={error}
        extra={
          <>
            {rule}
            {capsLock && (
              <p id={`${id}-caps`} className="ss-auth-caps" role="status">
                <ArrowBigUp aria-hidden="true" size={16} strokeWidth={2.25} />
                Caps Lock is on
              </p>
            )}
          </>
        }
      />
    </div>
  );
}
