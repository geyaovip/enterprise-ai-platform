export const APPEARANCE_KEY = "zhixingark:appearance";

// Runs before application styles/bundles so a saved dark preference never paints
// a light shell first. Only private application HTML receives this bootstrap.
export const appearanceBootstrap = `(()=>{let p='system';try{const v=localStorage.getItem(${JSON.stringify(APPEARANCE_KEY)});if(v==='light'||v==='dark')p=v}catch{}const d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.appearance=p;document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.style.colorScheme=d?'dark':'light'})();`;
export const appearanceCriticalCss =
  'html{background:#f6f7fb;color-scheme:light}html[data-theme="dark"]{background:#15171d;color-scheme:dark}';
