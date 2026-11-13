import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { resolveEmbeddedSolanaAccount, resolveSolanaWallet } from '../services/wallet-selection.ts';

const require = createRequire(import.meta.url);
const privyRequire = createRequire(require.resolve('@privy-io/react-auth/solana'));
const { ConnectedStandardSolanaWallet } = privyRequire('@privy-io/js-sdk-core');
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
// Execute the real session component with a minimal hook scheduler and controllable SDK.
function session(createWallet) {
  const slots = [], effects = [];
  let cursor = 0, loginComplete, modal, walletContext;
  const sdk = { ready: true, authenticated: true, user: { id: 'alice', linkedAccounts: [] }, logout: async () => {}, linkWallet() {}, getAccessToken: async () => 'token' };
  const walletSdk = { ready: true, wallets: [] };
  class SigningImplementation {
    #sign;
    constructor(sign) { this.#sign = sign; }
    signMessage(input) { return this.#sign(input); }
  }
  class PrivyStandardWallet {
    constructor(signMessage) {
      this.name='Privy'; this.isPrivyWallet=true;
      this.accounts=[{address:'11111111111111111111111111111111',publicKey:new Uint8Array(32),chains:['solana:mainnet'],features:['solana:signMessage']}];
      const implementation=new SigningImplementation(signMessage);
      // Match the installed Privy wrapper: it extracts an unbound class method.
      this.features={
        'privy:':{privy:{signMessage:implementation.signMessage}},
        'solana:signMessage':{version:'1.0.0',signMessage:async(...inputs)=>{
          const results=[];
          for(const {account,...input} of inputs) {
            const result=await implementation.signMessage({...input,address:account.address});
            results.push({...result,signedMessage:input.message});
          }
          return results;
        }},
      };
    }
  }
  const standardSdk = { ready: true, wallets: [] };
  let messageSigner = ({wallet,message}) => wallet.signMessage({message});
  const effect = (fn, deps) => {
    const i = cursor++;
    if (!slots[i] || deps.some((dep, j) => !Object.is(dep, slots[i].deps[j]))) {
      effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
    }
  };
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (next) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn) { return fn; }, useEffect: effect, useLayoutEffect: effect,
  };
  let resets = 0;
  const state = { reset() {}, resetAll() { resets++; }, clearCopy() {}, initialize() {}, setWalletState() {} };
  const store = { getState: () => state };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../components/auth/privy-session.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    exports, URL, TextEncoder, btoa, window: { location: { href: 'https://oren.finance/app' }, localStorage: { getItem: () => null } },
    require(id) {
      if (id === 'react') return react;
      if (id === '@privy-io/react-auth') return { useAuthorizationSignature: () => ({ generateAuthorizationSignature: async () => ({ signature: 'request-signature' }) }), useSigners: () => ({ addSigners: async () => {}, removeSigners: async () => {} }), usePrivy: () => sdk, useLogin: ({ onComplete }) => { loginComplete = onComplete; return { login() {} }; } };
      if (id === '@privy-io/react-auth/solana') return { useStandardWallets: () => standardSdk, useWallets: () => walletSdk, useCreateWallet: () => ({ createWallet }), useSignMessage: () => ({ signMessage: (...args) => messageSigner(...args) }), useSignTransaction: () => ({}) };
      if (id === 'next/navigation') return { usePathname: () => '/app' };
      if (id === '@/store') return Object.fromEntries(['useAgentStore','useExecutionStore','usePortfolioStore','useSocialStore','useVaultStore','useWalletStore'].map(k => [k, store]));
      if (id === '@/services/wallet-session') return { invalidateWalletSession() {}, walletSessionIsCurrent: () => () => true };
      if (id === '@/services/approval-service') return { getApprovalAuthorizationRequest: async () => ({}) };
      if (id === '@/services/agent-service') return { setAgentTokenProvider() {} };
      if (id === '@/services/privy-signer') return { createPrivySigner: () => ({}) };
      if (id === '@/services/wallet-selection') return { resolveEmbeddedSolanaAccount, resolveSolanaWallet };
      if (id === './auth-context') return { AuthContext: { Provider: 'auth' } };
      if (id === './email-login') return { EmailLogin: 'email-login' };
      if (id === '@solana/wallet-adapter-react') return { WalletContext: { Provider: 'wallet' } };
      if (id === './wallet-modal-context') return { WalletModalContext: { Provider: 'wallet-modal' } };
      return require(id);
    },
  });
  function render() {
    cursor = 0;
    const tree = exports.PrivySession({ children: null });
    walletContext = tree.props.children.props.value;
    modal = tree.props.children.props.children.props.value;
    while (effects.length) effects.shift()();
    return tree.props.value;
  }
  return { sdk, walletSdk, standardSdk, setMessageSigner: signer => { messageSigner = signer; }, embeddedSigner: signer => new PrivyStandardWallet(signer), render, wallet: () => walletContext, resetCount: () => resets, requestConnection: () => modal.setVisible(true), isLoginOpen: () => modal.visible, completeLogin: data => loginComplete(data) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

const permission = 'Oren chat trading permission\n{"action":"prepare"}';
const permissionAddress = '11111111111111111111111111111111';
function permissionSession() {
  const app = session(async () => { throw new Error('must not create another wallet'); });
  app.sdk.user.linkedAccounts = [{ type: 'wallet', chainType: 'solana', walletClientType: 'privy', address: permissionAddress }];
  return app;
}
test('permission signing restores the exact embedded account before connected wallet discovery', async () => {
  const app = permissionSession();
  app.walletSdk.ready = false;
  let calls = 0;
  app.standardSdk.wallets = [app.embeddedSigner(async ({address,message}) => {
    calls++;
    assert.equal(address,permissionAddress);
    assert.equal(new TextDecoder().decode(message),permission);
    return {signature:new Uint8Array([1,2,3])};
  })];
  assert.equal(await app.render().signTradePermission(permissionAddress,permission),'AQID');
  assert.equal(calls,1);
});
test('the installed connected-wallet class and standard feature preserve private signer receivers', async () => {
  const app=permissionSession();let calls=0;
  const standard=app.embeddedSigner(async()=>{calls++;return {signature:new Uint8Array([1,2,3])};});
  assert.throws(()=>standard.features['privy:'].privy.signMessage({message:new Uint8Array([1]),address:permissionAddress}),/private/i);
  app.walletSdk.wallets=[new ConnectedStandardSolanaWallet({wallet:standard,account:standard.accounts[0]})];
  assert.equal(await app.render().signTradePermission(permissionAddress,permission),'AQID');
  assert.equal(calls,1);
});
test('legacy readiness cannot block the selected embedded account when SDK account lists are empty', async () => {
  const app=permissionSession();app.walletSdk.ready=false;
  let calls=0;
  const standard=app.embeddedSigner(async({address})=>{
    calls++;assert.equal(address,permissionAddress);
    return {signature:new Uint8Array([1,2,3])};
  });
  const native=standard.features['solana:signMessage'].signMessage;
  standard.features['solana:signMessage'].signMessage=(input)=>{
    assert.equal(input.account.address,permissionAddress);
    assert.equal(input.account.publicKey.length,32);
    return native(input);
  };
  standard.accounts=[];app.standardSdk.wallets=[standard];
  assert.equal(await app.render().signTradePermission(permissionAddress,permission),'AQID');
  assert.equal(calls,1);
});
test('a standard wallet without the exact owned account cannot sign a permission', async () => {
  const app=permissionSession();
  const standard=app.embeddedSigner(async()=>{throw new Error('must not sign another account');});
  standard.accounts=[{...standard.accounts[0],address:'other-address'}];
  app.standardSdk.wallets=[standard];
  await assert.rejects(app.render().signTradePermission(permissionAddress,permission),/still restoring/);
});
test('permission signing refuses a different wallet or unrelated message before Privy', async () => {
  const app = permissionSession();
  app.standardSdk.wallets = [app.embeddedSigner(async () => { throw new Error('must not reach Privy'); })];
  const auth=app.render();
  await assert.rejects(auth.signTradePermission('other-wallet',permission),/active wallet/);
  await assert.rejects(auth.signTradePermission(permissionAddress,'other message'),/active wallet/);
});
test('permission signing reports restoration instead of opening an external wallet', async () => {
  const app=permissionSession();
  app.standardSdk.wallets=[{name:'external',features:{'privy:':{privy:{signMessage:()=>{throw new Error('must not reach external wallet');}}}}}];
  await assert.rejects(app.render().signTradePermission(permissionAddress,permission),/still restoring/);
});
test('a rejected connected-wallet prompt never falls back to a second signer prompt', async () => {
  const app=permissionSession();
  app.walletSdk.wallets=[{address:permissionAddress}];
  app.setMessageSigner(async()=>{throw new Error('user rejected');});
  app.standardSdk.wallets=[app.embeddedSigner(async()=>{throw new Error('must not retry');})];
  await assert.rejects(app.render().signTradePermission(permissionAddress,permission),/user rejected/);
});
test('an account change during permission confirmation discards its late signature', async () => {
  const app=permissionSession();
  const pending=deferred();
  app.standardSdk.wallets=[app.embeddedSigner(()=>pending.promise)];
  const result=app.render().signTradePermission(permissionAddress,permission);
  app.sdk.user={id:'bob',linkedAccounts:[]}; app.render();
  pending.resolve({signature:new Uint8Array([1,2,3])});
  await assert.rejects(result,/wallet changed/);
});
test('a stale permission callback cannot sign after switching the selected wallet', async () => {
  const app=permissionSession();
  const second='SysvarRent111111111111111111111111111111111';
  app.sdk.user.linkedAccounts.push({type:'wallet',chainType:'solana',walletClientType:'privy',address:second});
  app.standardSdk.wallets=[app.embeddedSigner(async()=>{throw new Error('must not sign stale account');})];
  const auth=app.render(); auth.selectWallet(second); app.render();
  await assert.rejects(auth.signTradePermission(permissionAddress,permission),/active wallet/);
});
test('sign-out during permission confirmation discards the late signature', async () => {
  const app=permissionSession(); const pending=deferred();
  app.standardSdk.wallets=[app.embeddedSigner(()=>pending.promise)];
  const result=app.render().signTradePermission(permissionAddress,permission);
  app.sdk.authenticated=false; app.sdk.user=null; app.render();
  pending.resolve({signature:new Uint8Array([1,2,3])});
  await assert.rejects(result,/wallet changed/);
});

test('an already loaded owned wallet stays available while SDK discovery refreshes', async () => {
  const app = session(async () => { throw new Error('must not recreate an existing wallet'); });
  const address = '11111111111111111111111111111111';
  app.sdk.user.linkedAccounts = [{ type: 'wallet', chainType: 'solana', walletClientType: 'privy', address }];
  app.walletSdk.wallets = [{ address, standardWallet: { name: 'Privy' } }];
  assert.equal(app.render().address, address);
  const loadedResets = app.resetCount();
  app.walletSdk.ready = false;
  const auth = app.render();
  assert.equal(auth.address, address);
  assert.equal(auth.ready, true);
  assert.equal(app.wallet().connected, true);
  assert.equal(app.wallet().connecting, false);
  assert.equal(app.wallet().signTransaction, undefined);
  await assert.rejects(app.wallet().sendTransaction(), /Review and confirm/);
  assert.equal(app.resetCount(), loadedResets);
  app.sdk.user = { id: 'bob', linkedAccounts: [] };
  assert.equal(app.render().address, undefined);
  assert.equal(app.wallet().connected, false);
});

test('a trade connect request during Privy wallet restoration never links another wallet', () => {
  let links = 0, creations = 0;
  const app = session(async () => { creations++; });
  app.sdk.linkWallet = () => { links++; };
  app.sdk.user.linkedAccounts = [{ type: 'wallet', chainType: 'solana', walletClientType: 'privy', address: '11111111111111111111111111111111' }];
  app.walletSdk.ready = false;
  app.render(); app.requestConnection();
  const auth = app.render();
  assert.equal(links, 0);
  assert.equal(creations, 0);
  assert.equal(auth.depositOpen, false);
  assert.equal(app.isLoginOpen(), false);
  app.walletSdk.ready = true;
  app.walletSdk.wallets = [{ address: '11111111111111111111111111111111', standardWallet: { name: 'Privy' } }];
  const restored = app.render();
  assert.equal(restored.address, '11111111111111111111111111111111');
  app.requestConnection();
  assert.equal(links, 0);
  assert.equal(creations, 0);
});

test('a signed-out trade connect request opens sign-in without linking a wallet', () => {
  let links = 0;
  const app = session(async () => {});
  app.sdk.linkWallet = () => { links++; };
  app.sdk.user = null; app.sdk.authenticated = false;
  app.render(); app.requestConnection();
  assert.equal(app.render().authenticated, false);
  assert.equal(app.isLoginOpen(), true);
  assert.equal(links, 0);
});

test('email sign-in automatically creates one wallet despite rerenders and simultaneous retry', async () => {
  const pending = deferred(); let calls = 0;
  const app = session(() => { calls++; return pending.promise; });
  app.render();
  assert.equal(calls, 1);
  const auth = app.render();
  assert.equal(auth.authenticated, true);
  assert.equal(auth.walletPreparing, true);
  await auth.createWallet();
  app.render();
  assert.equal(calls, 1);
  pending.resolve({}); await settle();
  app.render(); app.render();
  assert.equal(calls, 1);
});

test('failed automatic setup stops retrying until an explicit recovery request', async () => {
  let calls = 0;
  const app = session(async () => { calls++; throw new Error('network'); });
  app.render(); await settle();
  const auth = app.render();
  assert.match(auth.error, /retry/i);
  app.render(); await settle(); assert.equal(calls, 1);
  await auth.createWallet(); assert.equal(calls, 2);
});

test('existing embedded wallets and unrestored sessions do not create another wallet', () => {
  let calls = 0;
  const app = session(async () => { calls++; });
  app.sdk.user.linkedAccounts = [{ type: 'wallet', chainType: 'solana', walletClientType: 'privy', address: '11111111111111111111111111111111' }];
  app.render(); assert.equal(calls, 0);
  app.sdk.user = { id: 'bob', linkedAccounts: [] }; app.walletSdk.ready = false; app.sdk.ready = false;
  app.render(); assert.equal(calls, 0);
  app.sdk.ready = true; app.render(); assert.equal(calls, 1);
});

test('server trading restores the authenticated embedded address without browser wallet discovery', () => {
  let creations = 0;
  const app = session(async () => { creations++; });
  const address = '11111111111111111111111111111111';
  app.sdk.user.linkedAccounts = [{ type: 'wallet', chainType: 'solana', walletClientType: 'privy', address }];
  app.walletSdk.ready = false;
  const restored = app.render();
  assert.equal(restored.ready, true);
  assert.equal(restored.address, address);
  assert.equal(restored.walletPreparing, false);
  assert.equal(app.wallet().publicKey.toBase58(), address);
  assert.equal(app.wallet().connected, true);
  const resetCount = app.resetCount();
  app.walletSdk.ready = true;
  app.walletSdk.wallets = [{ address, standardWallet: { name: 'Privy' } }];
  assert.equal(app.render().address, address);
  assert.equal(app.resetCount(), resetCount);
  assert.equal(creations, 0);
  app.sdk.user = { id: 'bob', linkedAccounts: [] }; app.sdk.ready = false;
  assert.equal(app.render().address, undefined);
  assert.equal(app.wallet().connected, false);
});

test('signed-out sessions are ready without browser discovery and ignore stale wallet objects', () => {
  const app = session(async () => { throw new Error('must not create while signed out'); });
  app.sdk.authenticated = false; app.sdk.user = null; app.walletSdk.ready = false;
  app.walletSdk.wallets = [{ address: '11111111111111111111111111111111', standardWallet: { name: 'Privy' } }];
  const auth = app.render();
  assert.equal(auth.ready, true);
  assert.equal(auth.address, undefined);
  assert.equal(auth.authenticated, false);
});

test('an external wallet cannot block automatic embedded setup or become the server trade account', () => {
  let creations = 0;
  const app = session(async () => { creations++; });
  app.sdk.user.linkedAccounts = [{ type: 'wallet', chainType: 'solana', walletClientType: 'phantom', address: '11111111111111111111111111111111' }];
  app.walletSdk.ready = false;
  assert.equal(app.render().address, undefined);
  assert.equal(creations, 1);
});

test('late setup failure from a previous user cannot overwrite the next account', async () => {
  const old = deferred(), next = deferred(); let calls = 0;
  const app = session(() => ++calls === 1 ? old.promise : next.promise);
  app.render();
  app.sdk.user = { id: 'bob', linkedAccounts: [] }; app.render();
  assert.equal(calls, 2);
  old.reject(new Error('old failure')); await settle();
  const auth = app.render(); assert.equal(auth.error, undefined); assert.equal(auth.busy, true);
  next.resolve({}); await settle(); assert.equal(app.render().busy, false);
});

test('new signup opens deposit in place and closing it preserves the app route', () => {
  const app = session(async () => {});
  app.render(); app.completeLogin({ isNewUser: true, wasAlreadyAuthenticated: false });
  assert.equal(app.render().depositOpen, true);
  app.render().closeDeposit(); assert.equal(app.render().depositOpen, false);
  app.render().openDeposit(); assert.equal(app.render().depositOpen, true);
});

test('signed-out sessions render safely and cannot create wallets', () => {
  let calls = 0;
  const app = session(async () => { calls++; });
  app.sdk.user = null; app.sdk.authenticated = false;
  const auth = app.render();
  assert.equal(auth.authenticated, false);
  assert.equal(auth.error, undefined);
  assert.equal(calls, 0);
});

test('sign-out remains available while wallet setup is pending', async () => {
  const pending = deferred();
  const app = session(() => pending.promise);
  let loggedOut = false;
  app.sdk.logout = async () => { loggedOut = true; };
  app.render(); await app.render().signOut();
  assert.equal(loggedOut, true);
  app.sdk.authenticated = false; app.sdk.user = null; app.render();
  pending.reject(new Error('late failure')); await settle();
  assert.equal(app.render().error, undefined);
});
