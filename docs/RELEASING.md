# Publishing an update (one time setup, then two commands)

NetEventPro has a built-in update source: `https://github.com/rijoshp-web/neteventpro-releases/releases/latest/download/latest.json`
and a built-in public key (`src/update-defaults.js`). Nobody who installs the program has to enter an address or key.

## One time
1. Create the GitHub repository `rijoshp-web/neteventpro-releases` (Releases must be readable without a login, so make the repository public, or keep your source private in another repository and publish only the releases here).
2. Push the program files to it.
3. Repository → Settings → Secrets and variables → Actions → New secret: name `NEP_RELEASE_KEY`, value = the full text of `neteventpro-release-private.pem` (including the BEGIN/END lines). Keep a backup of that file somewhere safe and never put it in the repository. Whoever has it can publish updates that every installation will accept.

## For every release
```
npm run bump -- minor        (or patch)
git add -A && git commit -m "NetEventPro 1.x.y" && git tag v1.x.y && git push && git push --tags
```
The `Publish update` workflow runs the tests, signs the package and creates the release. Within hours (or at once with the Update button) every installed copy sees it. The update button replaces only the program files, never settings, data or users, and rolls back by itself if the new version does not start.

## Lost or leaked key
Run `node scripts/release.js keygen`, put the new public key into `src/update-defaults.js`, store the new private key as the secret, and install that version once with the installer on every computer (an old copy will not accept packages signed by the new key).
