export type NavIconName = "painel" | "agenda" | "pedidos" | "catalogo" | "clientes" | "equipe" | "sair";

const paths: Record<NavIconName, React.ReactNode> = {
  painel: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  agenda: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 11h18" /></>,
  pedidos: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 3h6v4H9zM9 12h6m-6 4h6" /></>,
  catalogo: <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />,
  clientes: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3" /></>,
  equipe: <><circle cx="12" cy="7" r="3" /><path d="M6 21v-3a6 6 0 0 1 12 0v3M3 7a3 3 0 0 0 2 5m14-5a3 3 0 0 1-2 5M1 21v-3a4 4 0 0 1 2-3m20 6v-3a4 4 0 0 0-2-3" /></>,
  sair: <path d="M9 5H4v14h5m5-14 7 7-7 7m-6-7h13" />,
};

export function NavIcon({ name, className = "" }: { name: NavIconName; className?: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${className}`}>{paths[name]}</svg>;
}
