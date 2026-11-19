# Code signing the NetEventPro installer

A signed installer shows your company name in the Windows "Do you want to allow…" box instead of "Unknown publisher",
and SmartScreen and antivirus programs trust it sooner. `build.ps1` signs the installer, its uninstaller and the service
program when it is given a code-signing certificate; without one it builds an unsigned installer as before.

## 1. Get a certificate (once, renewed every 1–3 years)

Buy an **OV (organisation validated) code-signing certificate** from a certificate authority such as DigiCert, Sectigo,
GlobalSign or SSL.com. The authority checks that your company exists, which takes a few days.
Since June 2023 the private key of every new code-signing certificate must live on hardware: a **USB token** or a
**cloud signing service** (for example DigiCert KeyLocker, SSL.com eSigner or Microsoft Trusted Signing). A plain .pfx
file is only possible with an older certificate.

## 2. Sign when you build

On the Windows build PC (Inno Setup and the Windows SDK installed — `winget install Microsoft.WindowsSDK.10.0.22621`):

- **USB token** (plugged in; the certificate shows in the Windows certificate store):
  `powershell -ExecutionPolicy Bypass -File .\build.ps1 -CertThumbprint <thumbprint of the certificate>`
  (find the thumbprint with `Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert`)
- **.pfx file** (older certificates): `.\build.ps1 -CertPath C:\keys\nep-codesign.pfx -CertPassword '...'`
- **GitHub Actions** (.pfx only): add the repository secrets `NEP_SIGN_PFX` (the .pfx file as base64:
  `[Convert]::ToBase64String([IO.File]::ReadAllBytes('nep-codesign.pfx'))`) and `NEP_SIGN_PASSWORD`. The
  "Build Windows installer" workflow then signs by itself. A USB token cannot be used there; a cloud signing service can,
  with the provider's own signing step.

The build checks the signature at the end (`signtool verify /pa`) and stops if it does not verify. Signatures are
time-stamped, so installers signed today stay valid after the certificate expires.

## 3. Check

Right-click the installer → Properties → **Digital Signatures**: your company name, and "This digital signature is OK".

Keep the certificate and its password like the release signing key: never in the program files, the release repository
or an e-mail.
