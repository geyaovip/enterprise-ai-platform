import { Children, isValidElement, useRef, useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import { SearchSelect } from './SearchSelect';

function plainText(children: ReactNode): string { return Children.toArray(children).map(child => isValidElement<{children?:ReactNode}>(child) ? plainText(child.props.children) : typeof child === 'string' || typeof child === 'number' ? String(child) : '').join(''); }
function choices(children: ReactNode, disabled = false): Array<{value:string;label:string;disabled:boolean}> {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{value?:string|number;children?:ReactNode;disabled?:boolean}>(child)) return [];
    const label = plainText(child.props.children).trim();
    return child.type === 'option' ? [{value:String(child.props.value ?? label),label,disabled:disabled || Boolean(child.props.disabled)}] : choices(child.props.children, disabled || Boolean(child.props.disabled));
  });
}

/** Complete option sets keep real native change events and form/dirty-check values. */
export function ChoiceSelect({ label, labelHidden, children, value, required, disabled, ...native }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'multiple'> & {label:string;labelHidden?:boolean}) {
  const select = useRef<HTMLSelectElement>(null), [query, setQuery] = useState('');
  const options = choices(children), empty = options.find(option => !option.value);
  return <><SearchSelect label={label} labelHidden={labelHidden} value={String(value ?? '')} required={required} disabled={disabled} clearable={Boolean(empty)} emptyLabel={empty?.label}
    selectedLabel={options.find(option => option.value === String(value ?? ''))?.label ?? (String(value??'') ? '已选择的记录' : undefined)}
    options={options.filter(option => option.value && (!query || option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))} query={query} onQueryChange={setQuery}
    onChange={next => { if (!select.current || select.current.matches(':disabled')) return; select.current.value = next; select.current.dispatchEvent(new Event('change', {bubbles:true})); }}/>
    <select {...native} ref={select} hidden style={{display:'none'}} aria-hidden="true" tabIndex={-1} value={value} disabled={disabled} required={false}>{children}</select>
  </>;
}
