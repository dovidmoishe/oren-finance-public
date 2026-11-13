import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight02Icon, ArrowDown01Icon, Search01Icon, Briefcase01Icon, Tick02Icon, RefreshIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { OrenLogo } from '@/components/brand/oren-logo';
import { LandingHeader } from '@/components/landing/landing-header';
import { LandingFooter } from '@/components/landing/landing-footer';
import { ButtonLink } from '@/components/ui';
import { AgentClientLinks, AgentLogo } from './agent-clients';
import { AGENT_CLIENTS } from './agent-client-data';
import { AgentSetup } from './agent-setup';
import { AgentConversationDemo } from './agent-conversation-demo';

const title = 'Connect your agent — Oren';
const description = 'Research stocks, understand your portfolio, and trade from Claude, Cursor or Codex. Inside limits you set.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/agents' },
  openGraph: { title, description, url: '/agents', type: 'website' },
  twitter: { card: 'summary_large_image', title, description },
};

const STEPS = [
  { title: 'Sign in to Oren', body: 'Use your email. Oren creates a Solana wallet for your account.', link: { href: '/app', label: 'Sign in' } },
  { title: 'Add money', body: 'Deposit USDC from the account menu. Your agent can only use what’s in your wallet.' },
  { title: 'Set your limits', body: 'In Agent connections, choose a per-trade and daily limit and approve them with your wallet. Skip this and your agent can still prepare trades for you to review.', link: { href: '/settings/mcp', label: 'Agent connections' } },
  { title: 'Add Oren to your agent', body: 'Pick your app below and follow the steps. It takes about a minute.', link: { href: '#setup', label: 'Setup steps' } },
  { title: 'Ask it to trade', body: 'Under your limit, it trades. Above it, the trade waits for you to review in Oren.' },
];

const SAFEGUARDS = [
  { title: 'Your limits are signed', body: 'Per-trade and daily limits are approved with your wallet, and Oren checks them again before every trade.' },
  { title: 'Your spending limits', body: 'Choose how much your agent can trade at once and in any rolling 24-hour period. Revoke your trading permission anytime.' },
  { title: 'Two keys to sign', body: 'Every chat trade needs two independent approvals before it reaches your wallet.' },
  { title: 'Off in one click', body: 'Revoke an app or your limits anytime in Agent connections. It stops immediately.' },
];

const FAQ = [
  { q: 'Do I give my agent a key or password?', a: 'No. Your app opens Oren’s sign-in page, you sign in with your email and approve what it can do. Oren never asks for your seed phrase or private key.' },
  { q: 'What can my agent do without limits set?', a: 'It can read your portfolio, look up stocks and prepare buys or sells. You review and confirm each one in Oren before anything is sent.' },
  { q: 'Can it trade more than my limit?', a: 'No. Trades above your per-trade or daily limit wait for you to review in Oren instead.' },
  { q: 'Which stocks can it trade?', a: 'Any tokenized stock you can trade in Oren, buying or selling against USDC.' },
  { q: 'How do I disconnect?', a: 'Open Agent connections and revoke the app. You can also turn off chat trading there.' },
];

const USE_CASES = [
  { label: 'Research', icon: Search01Icon, prompt: 'What’s happening with NVIDIA?', body: 'Explore stock signals, market context and the news behind a move.' },
  { label: 'Portfolio', icon: Briefcase01Icon, prompt: 'How is my portfolio doing?', body: 'Bring your holdings into the conversation, without switching apps.' },
  { label: 'Trading', icon: ArrowRight02Icon, prompt: 'Buy $5 of NVIDIA.', body: 'Turn a decision into a trade, with limits and approvals in place.' },
];

export default function AgentsPage() {
  return <div className="agents-page" id="top">
    <LandingHeader><nav className="agents-nav" aria-label="Main navigation">
      <Link className="agents-brand" href="/" aria-label="Oren home"><OrenLogo size={28} /><span>OREN</span></Link>
      <div className="agents-nav-links"><Link href="/app/markets">Markets</Link><Link href="/agents" aria-current="page">Agents</Link><Link href="/roadmap">Roadmap</Link><Link href="/changelog">Changelog</Link></div>
      <div className="agents-nav-right"><AgentClientLinks /><ButtonLink className="h-10 rounded-full px-4 text-sm font-medium" href="/app" variant="primary">Launch App <HugeiconsIcon icon={ArrowRight02Icon} size={16} /></ButtonLink></div>
    </nav></LandingHeader>
    <main className="relative">
      <section className="agents-hero" aria-labelledby="hero-title">
        <div className="agents-eyebrow"><OrenLogo size={20} /> Oren for AI agents</div>
        <h1 id="hero-title">Your next trade.<br /><span>Starts with a conversation.</span></h1>
        <p className="agents-lede">Research stocks, understand your portfolio and trade from Claude, Cursor or Codex. Connected through Oren. Controlled by you.</p>
        <div className="agents-hero-actions"><ButtonLink className="h-11 rounded-full px-5 text-sm font-medium" href="#setup" variant="primary">Connect your agent <HugeiconsIcon icon={ArrowRight02Icon} size={16} /></ButtonLink><Link className="agents-text-link" href="#how">See how it works <HugeiconsIcon icon={ArrowDown01Icon} size={15} /></Link></div>
      </section>
      <section className="agents-demo-section" aria-labelledby="ask-title">
        <div className="agents-demo-stage"><h2 className="agents-screen-reader-only" id="ask-title">See a conversation become a trade</h2><AgentConversationDemo /></div>
        <div className="agents-compatibility"><p>AT HOME IN THE APPS YOU ALREADY USE</p><div>{AGENT_CLIENTS.map(client => <Link key={client.id} href={'#'+client.id}><AgentLogo src={client.logo} /><span>{client.label}</span></Link>)}</div></div>
      </section>
      <section className="[background:#f6f4ef]" aria-labelledby="connection-title"><div className="agents-split">
        <div className="agents-editorial-copy"><p className="agents-kicker">A familiar place to invest</p><h2 id="connection-title">Keep the conversation.<br />Add the ability to act.</h2><p>Your AI app already knows how you think. Oren connects it to your portfolio, stock research and trading on Solana.</p><p>Ask in your own words. Review each trade yourself, or approve bounded trading limits for your agent.</p><Link className="agents-text-link" href="#setup">Find your app <HugeiconsIcon icon={ArrowRight02Icon} size={16} /></Link></div>
        <div className="agents-connection-art" role="img" aria-label="Claude, Cursor and Codex connect through Oren to research, portfolio and trades"><div className="agents-connection-apps">{AGENT_CLIENTS.map(client => <span key={client.id}><AgentLogo src={client.logo} />{client.label}</span>)}</div><div className="agents-connection-hub"><OrenLogo size={44} /><strong>Oren</strong><small>One connection</small></div><div className="agents-connection-tools"><span>Research</span><span>Portfolio</span><span>Trades</span></div><p className="agents-art-caption">Your AI app. Your onchain portfolio.</p></div>
      </div></section>
      <section className="agents-how-band" id="how" aria-labelledby="how-title"><div className="agents-split">
        <div className="agents-editorial-copy"><p className="agents-kicker">How it works</p><h2 id="how-title">A few steps.<br />Then you’re connected.</h2><p>Start with your Oren account. Choose what your agent can do, then bring it into your favorite app.</p><ButtonLink className="h-10 rounded-full px-5 text-sm" href="#setup" variant="primary">Get connected <HugeiconsIcon icon={ArrowRight02Icon} size={15} /></ButtonLink></div>
        <ol className="list-none [margin:0] [padding:0_0_0_14px] [border-left:1px_solid_#b8bfaa] grid [gap:8px]">{STEPS.map((step,index)=><li className="agents-step" key={step.title}><span className="agents-step-number">{String(index+1).padStart(2,'0')}</span><div><h3>{step.title}</h3><p>{step.body}</p>{step.link && <Link className="agents-step-link" href={step.link.href}>{step.link.label}<HugeiconsIcon icon={ArrowRight02Icon} size={14} /></Link>}</div></li>)}</ol>
      </div></section>
      <section className="agents-section" aria-labelledby="use-title"><div className="agents-section-heading"><p className="agents-kicker">A place to start</p><h2 id="use-title">Less switching tabs.<br />More moving forward.</h2><p>A question, a portfolio check, a decision. Start wherever you are.</p></div><div className="agents-use-cases">{USE_CASES.map(item=><article className="agents-use-case" key={item.label}><span className="agents-use-case-label"><HugeiconsIcon icon={item.icon} size={18} />{item.label}</span><h3>“{item.prompt}”</h3><p>{item.body}</p><Link className="agents-step-link" href="#setup">Connect to try it <HugeiconsIcon icon={ArrowRight02Icon} size={14} /></Link></article>)}</div></section>
      <section className="[background:#f3f4ee]" aria-labelledby="safe-title"><div className="agents-section-inner"><div className="agents-section-heading"><p className="agents-kicker">The boundaries are yours</p><h2 id="safe-title">More capability.<br />The same control.</h2><p>You decide what’s allowed. Oren checks before it acts.</p></div><div className="agents-safeguards">{SAFEGUARDS.map((item,index)=><article className="agents-safeguard" key={item.title}><span className="agents-control-icon">{index===2 ? <OrenLogo size={22} /> : <HugeiconsIcon icon={[Tick02Icon,Briefcase01Icon,Tick02Icon,RefreshIcon][index]} size={22} />}</span><h3>{item.title}</h3><p>{item.body}</p></article>)}</div><Link className="agents-control-link" href="/settings/mcp">Manage agent connections <HugeiconsIcon icon={ArrowRight02Icon} size={15} /></Link></div></section>
      <section className="agents-section" id="setup" aria-labelledby="setup-title"><div className="agents-section-heading"><p className="agents-kicker">Make it yours</p><h2 id="setup-title">Choose your app.<br />We’ll meet you there.</h2><p>Follow the setup below, then sign in to connect your account.</p></div><AgentSetup /></section>
      <section className="agents-faq-section" aria-labelledby="faq-title"><div className="agents-section-heading"><p className="agents-kicker">Before you begin</p><h2 id="faq-title">A little more clarity.</h2></div><div className="agents-faq">{FAQ.map(item=><details key={item.q}><summary>{item.q}<HugeiconsIcon icon={ArrowDown01Icon} size={17} aria-hidden="true" /></summary><p>{item.a}</p></details>)}</div></section>
      <section className="agents-cta"><p className="agents-kicker">Your next move</p><h2>A familiar app.<br />A new way to invest.</h2><p>Bring Oren into your next conversation.</p><ButtonLink className="h-11 rounded-full px-5 text-sm font-medium" href="#setup" variant="primary">Connect your agent <HugeiconsIcon icon={ArrowRight02Icon} size={16} /></ButtonLink></section>
    </main><LandingFooter />
  </div>;
}
