import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { createContext, createElement, useContext } from 'react';
const require = createRequire(import.meta.url);
const transpile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const noBrowserRpc = (id) => {
  if (id === '@solana/kit') throw new Error('Browser RPC must not be initialized');
};

for (const rpcOverride of [undefined, 'https://rpc.example.invalid/private-key-must-not-be-used']) {
  test(`authentication stays email-only and does not initialize browser RPC (${rpcOverride ? 'override' : 'default'})`, () => {
    const exports = {};
    let config;
    vm.runInNewContext(transpile('../components/auth/privy-auth.tsx'), {
      exports, process: { env: { NEXT_PUBLIC_PRIVY_APP_ID: 'offline-app', NEXT_PUBLIC_SOLANA_RPC_URL: rpcOverride } },
      require(id) {
        noBrowserRpc(id);
        if (id === '@privy-io/react-auth') return { PrivyProvider(props) { config = props.config; return props.children; } };
        if (id === '@solana/wallet-adapter-react') return { WalletContext: createContext({}), ConnectionProvider() { throw new Error('Browser RPC must not be initialized'); } };
        if (id === './auth-context') return { AuthContext: createContext({}) };
        if (id === './wallet-modal-context') return { WalletModalContext: createContext({}) };
        if (id === './privy-session') return { PrivySession: ({ children }) => children };
        return require(id);
      },
    });
    renderToStaticMarkup(createElement(exports.PrivyAuth, { appId: 'offline-app', onSession() {} }));
    assert.deepEqual(Array.from(config.loginMethods), ['email']);
    assert.equal(config.solana, undefined);
    // No external wallets: no Solana connectors, no WalletConnect, no wallet detection.
    assert.equal(config.externalWallets.solana, undefined);
    assert.equal(config.externalWallets.disableAllExternalWallets, true);
    assert.equal(config.externalWallets.walletConnect.enabled, false);
    assert.equal(config.embeddedWallets.solana.createOnLogin, 'off');
  });
}

function renderProviders(env) {
  const exports = {};
  const AuthContext = createContext({ configured: false, ready: true });
  const WalletContext = createContext({});
  const WalletModalContext = createContext({});
  let privyLoads = 0;
  vm.runInNewContext(transpile('../app/providers.tsx'), {
    exports, process: { env },
    require(id) {
      noBrowserRpc(id);
      if (id === 'next/dynamic') return { default: (load) => { privyLoads++; void load; return () => null; } };
      if (id === '@solana/wallet-adapter-react') return { WalletContext, ConnectionProvider() { throw new Error('Browser RPC must not be initialized'); } };
      if (id === '@/components/auth/auth-context') return { AuthContext };
      if (id === '@/components/auth/wallet-modal-context') return { WalletModalContext };
      if (id === '@/components/auth/privy-auth') throw new Error('Privy must be loaded lazily');
      return require(id);
    },
  });
  let seen;
  function Probe() {
    seen = { auth: useContext(AuthContext), wallet: useContext(WalletContext), modal: useContext(WalletModalContext) };
    return 'shell';
  }
  const html = renderToStaticMarkup(createElement(exports.AppProviders, null, createElement(Probe)));
  return { html, seen, privyLoads };
}

test('the app shell renders before Privy loads, with auth not ready', async () => {
  const { html, seen, privyLoads } = renderProviders({ NEXT_PUBLIC_PRIVY_APP_ID: 'offline-app' });
  assert.match(html, /shell/);
  assert.equal(privyLoads, 1);
  assert.equal(seen.auth.configured, true);
  assert.equal(seen.auth.ready, false);
  assert.equal(seen.auth.authenticated, false);
  assert.equal(seen.auth.address, undefined);
  assert.equal(seen.wallet.connected, false);
  assert.equal(seen.wallet.connecting, true);
  assert.equal(seen.wallet.publicKey, null);
  assert.equal(seen.wallet.signMessage, undefined);
  assert.equal(seen.modal.visible, false);
  await assert.rejects(seen.auth.authorizeTrade('approval', null), /Sign in/);
  await assert.rejects(seen.wallet.sendTransaction(), /Review and confirm/);
  assert.equal(await seen.auth.getAccessToken(), null);
});

test('without a Privy app id sign-in is unavailable and the wallet stays disconnected', () => {
  const { html, seen } = renderProviders({});
  assert.match(html, /shell/);
  assert.equal(seen.auth.configured, false);
  assert.equal(seen.wallet.connected, false);
  assert.equal(seen.wallet.connecting, false);
});

test('MCP connection page receives the app authentication provider', () => {
  const exports = {};
  const AuthContext = createContext({ ready: true, open() { throw new Error('default auth context'); } });
  const auth = { ready: true, open() {} };
  vm.runInNewContext(transpile('../app/connect/mcp/layout.tsx'), {
    exports,
    require(id) {
      if (id === '../../providers')
        return { AppProviders({ children }) { return createElement(AuthContext.Provider, { value: auth }, children); } };
      if (id === '@/i18n/personalized-intl')
        return { PersonalizedIntl({ children }) { return children; } };
      return require(id);
    },
  });
  let seen;
  function Probe() { seen = useContext(AuthContext); return null; }
  renderToStaticMarkup(createElement(exports.default, null, createElement(Probe)));
  assert.equal(seen, auth);
});
