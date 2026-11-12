'use strict';
// Built-in update source. Every copy of NetEventPro checks this release feed and trusts only packages signed by the matching private key.
// The private key is NOT in the program: it lives only in the GitHub repository secret NEP_RELEASE_KEY (see docs/RELEASING.md).
module.exports = {
  url: 'https://github.com/rijoshp-web/neteventpro-releases/releases/latest/download/latest.json',
  publicKey: 'YqRA4S60g40PXdcFor+F2h1to6aEbtL7mLpU46O6POs=',
};
