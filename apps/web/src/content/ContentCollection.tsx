import { useState, type ChangeEventHandler } from "react";
import { ImageIcon, MagnifyingGlassIcon, type Icon } from "@phosphor-icons/react";
import "./collection.css";

export function CollectionSearch({ label, value, onChange, maxLength }: {
  label: string;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  maxLength?: number;
}) {
  return <div className="content-collection-search">
    <MagnifyingGlassIcon size={17} aria-hidden="true" />
    <input type="search" aria-label={label} placeholder={label} value={value} onChange={onChange} maxLength={maxLength} />
  </div>;
}

export function CollectionEmpty({ icon: Icon, text }: { icon: Icon; text: string }) {
  return <div className="content-collection-empty" role="status">
    <span aria-hidden="true"><Icon size={25} /></span><p>{text}</p>
  </div>;
}

export function CollectionThumbnail({ src, alt = "" }: { src: string; alt?: string }) {
  const [failedUrl, setFailedUrl] = useState("");
  if (failedUrl === src || !src) return <ImageIcon size={27} aria-hidden="true" />;
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailedUrl(src)} />;
}
