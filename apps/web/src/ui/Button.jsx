import { Link } from 'react-router';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md font-ui font-semibold leading-none transition-colors ' +
  'disabled:cursor-not-allowed disabled:opacity-55 select-none whitespace-nowrap';

const VARIANTS = {
  primary: 'bg-carbon text-sheet hover:bg-carbon-strong',
  outline: 'border border-rule-strong bg-sheet text-ink hover:border-carbon hover:text-carbon',
  quiet: 'text-ink hover:bg-ink/6',
  danger: 'bg-correction text-sheet hover:brightness-95',
  'danger-outline': 'border border-correction/60 text-correction hover:bg-correction-wash',
};

const SIZES = {
  sm: 'h-9 px-3 text-sm min-w-9',
  md: 'h-11 px-4 text-[0.95rem] min-w-11',
  icon: 'h-11 w-11 text-base',
  'icon-sm': 'h-9 w-9 text-sm',
};

export function buttonClass(variant = 'outline', size = 'md', extra = '') {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

export function Button({ variant = 'outline', size = 'md', className = '', type = 'button', ...props }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({ variant = 'outline', size = 'md', className = '', ...props }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}
