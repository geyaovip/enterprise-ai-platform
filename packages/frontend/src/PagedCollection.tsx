import { Children, cloneElement, isValidElement, useId, useState, type ReactElement, type ReactNode } from 'react';
import { Empty, Pager } from './components';

type Container = ReactElement<{ children?: ReactNode }>;

/** Paginate complete in-memory record sets. Server-paged results use Pager directly. */
export function PagedCollection({ children, label = '列表分页', emptyText = '暂无记录', scope = '', size = 20, pagination }: { children: Container; label?: string; emptyText?:string; scope?: string; size?: number; pagination?: {page:number;total:number;size:number;onPage:(page:number)=>void} }) {
  const id = useId();
  const table = children.type === 'table';
  const parts = Children.toArray(children.props.children);
  const body = table ? parts.find(node => isValidElement(node) && node.type === 'tbody') as Container | undefined : children;
  const rows = Children.toArray(body?.props.children);
  const version = `${scope}:${rows.map((row, index) => isValidElement(row) ? row.key ?? index : index).join('|')}`;
  const [view, setView] = useState({ version, page: 1 });
  if (view.version !== version) setView({ version, page: 1 });
  const last = Math.max(1, Math.ceil(rows.length / size));
  const page = view.version === version ? Math.min(view.page, last) : 1;
  const slice = pagination ? rows : rows.slice((page - 1) * size, page * size);
  const content = table && body ? cloneElement(children, { children: parts.map(part => part === body ? cloneElement(body, { children: slice }) : part) }) : cloneElement(children, { children: slice });
  return <div className="paged-collection" id={id}>
    {!rows.length ? <Empty text={emptyText}/> : table ? <div className="table-wrap">{content}</div> : content}
    <Pager {...(pagination ?? {page,total:rows.length,size,onPage:(next:number) => setView({version, page:next})})} label={label}/>
  </div>;
}
