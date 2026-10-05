const base=require('./package.json').build;
module.exports={
  ...base,
  forceCodeSigning:false,
  artifactName:'Pine-Desk-${version}-unsigned-${arch}.${ext}',
  mac:{...base.mac,identity:null,notarize:false},
  publish:null,
  extraResources:[],
};
