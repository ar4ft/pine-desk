const {validateRelease}=require('./scripts/release-preflight.cjs');
validateRelease();
const base=require('./package.json').build;
module.exports={
  ...base,
  forceCodeSigning:true,
  artifactName:'Pine-Desk-${version}-${arch}.${ext}',
  extraResources:[{from:'build/release-channel.json',to:'release-channel.json'}],
  mac:{...base.mac,notarize:true,hardenedRuntime:true,entitlements:'build/entitlements.mac.plist',entitlementsInherit:'build/entitlements.mac.plist'},
  publish:[{provider:'github',owner:'ar4ft',repo:'pine-desk',releaseType:'draft',channel:'latest',vPrefixedTagName:true}],
};
