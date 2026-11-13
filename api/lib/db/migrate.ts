// Local compatibility shim. The production image runs migrate.mjs directly so
// migrations do not require the development-only tsx runtime.
import './migrate.mjs';
