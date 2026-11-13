import { dirname, join } from 'node:path';

// Keep the installed SDK's real canonicalization and P-256 signing while
// avoiding its unrelated ESM-only HTTP authentication dependencies in Jest.
const authorization = jest.requireActual<
  Pick<
    typeof import('@privy-io/node'),
    'formatRequestForAuthorizationSignature' | 'generateAuthorizationSignature'
  >
>(join(dirname(require.resolve('@privy-io/node')), 'lib/authorization.js'));
export const formatRequestForAuthorizationSignature =
  authorization.formatRequestForAuthorizationSignature;
export const generateAuthorizationSignature =
  authorization.generateAuthorizationSignature;
export const PrivyClient = jest.fn();
