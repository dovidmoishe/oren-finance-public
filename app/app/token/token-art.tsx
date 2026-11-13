
import { ArrowDown02Icon, ArrowUpRight01Icon, ArrowRight02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';

/** Original vector scenes, rather than a generic icon set. */
export function TokenArt({ kind }: { kind: "access" | "benefits" | "burn" }) {
  return <svg className="token-illustration" viewBox="0 0 280 180" fill="none" aria-hidden="true">
    <ellipse cx="140" cy="150" rx="88" ry="12" fill="#312047" opacity=".06" />
    {kind === "access" ? <>
      <path d="M57 57 191 39 210 130 76 148Z" fill="#d8c5f1" stroke="#bda5d5" />
      <g className="token-art-lift">
        <rect x="66" y="37" width="150" height="101" rx="15" fill="#fefcf8" stroke="#aa8dc7" strokeWidth="1.5" />
        <path d="M66 65h150" stroke="#dfd4e8" />
        <circle cx="82" cy="51" r="3" fill="#ab86d1" /><circle cx="93" cy="51" r="3" fill="#ddd0e9" />
        <path d="M83 115h34m-34 7h23" stroke="#bdb1c8" strokeWidth="3" strokeLinecap="round" />
        <path d="M166 84V73a14 14 0 0 1 28 0" stroke="#806397" strokeWidth="6" strokeLinecap="round" />
        <rect x="154" y="84" width="42" height="34" rx="10" fill="#b89bd6" />
        <circle cx="175" cy="99" r="4" fill="#fffdf7" /><path d="M175 101v6" stroke="#fffdf7" strokeWidth="3" strokeLinecap="round" />
      </g>
      <circle cx="218" cy="44" r="19" fill="#35303e" /><path d="m210 44 5 5 10-11" stroke="#e0ccfa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m48 94 4 8 8 4-8 4-4 8-4-8-8-4 8-4Z" fill="#baa2d2" />
    </> : kind === "benefits" ? <>
      <ellipse cx="140" cy="91" rx="96" ry="48" transform="rotate(-24 140 91)" stroke="#b6bfac" strokeDasharray="3 6" />
      <ellipse cx="140" cy="91" rx="91" ry="39" transform="rotate(26 140 91)" stroke="#c8d0bf" />
      <g className="token-art-lift">
        <path d="m140 39 43 25v50l-43 25-43-25V64Z" fill="#d0dbc4" stroke="#a3b393" strokeWidth="1.5" />
        <path d="m140 48 34 20v40l-34 20-34-20V68Z" fill="#f8faf3" stroke="#b1c29e" />
        <path d="m140 66 7 16 17 7-17 7-7 17-7-17-17-7 17-7Z" fill="#869c70" />
      </g>
      <rect x="35" y="88" width="31" height="31" rx="10" fill="#fdfcf7" stroke="#b2c0a3" /><path d="M43 105v-5m7 9V96m7 9v-8" stroke="#8c9d7a" strokeWidth="2" strokeLinecap="round" />
      <circle cx="220" cy="56" r="18" fill="#8b9f7a" /><path d="m212 56 5 5 11-11" stroke="#fafcf5" strokeWidth="2" strokeLinecap="round" />
      <circle cx="196" cy="129" r="6" fill="#c1a8db" /><circle cx="81" cy="45" r="4" fill="#a9bb96" />
    </> : <>
      <ellipse cx="140" cy="132" rx="66" ry="21" fill="#ecd8c5" stroke="#d0ae90" />
      <path d="M74 124v9c0 12 30 22 66 22s66-10 66-22v-9" fill="#ead4bf" stroke="#d0ae90" />
      <ellipse cx="140" cy="124" rx="66" ry="21" fill="#fcf7ef" stroke="#d0ae90" />
      <ellipse cx="140" cy="124" rx="43" ry="12" fill="#e4c6ac" opacity=".5" />
      <g className="token-art-lift">
        <path d="M144 34c8 26 32 30 32 53 0 22-16 37-36 37s-35-13-35-33c0-15 10-25 18-34-1 17 5 19 10 22 10-13 12-28 11-45Z" fill="#c3a1df" stroke="#9c79bc" strokeWidth="1.5" />
        <path d="M145 76c1 16 14 17 14 29 0 10-8 17-18 17s-17-7-17-16c0-10 14-18 21-30Z" fill="#f8e8d2" />
      </g>
      <path d="m197 58 4 8 8 4-8 4-4 8-4-8-8-4 8-4Z" fill="#c5a3de" />
      <circle cx="92" cy="49" r="4" fill="#d3b899" /><circle cx="181" cy="29" r="3" fill="#bb9ad5" />
    </>}
  </svg>;
}

export function ArrowIcon({ direction = "right" }: { direction?: "right" | "down" | "diagonal" }) {
  return <HugeiconsIcon icon={direction === "down" ? ArrowDown02Icon : direction === "diagonal" ? ArrowUpRight01Icon : ArrowRight02Icon} size={18} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" />;
}
