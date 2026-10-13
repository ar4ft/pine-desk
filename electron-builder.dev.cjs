const base=require('./package.json').build;
const arch=process.env.PINE_DESK_BUILD_ARCH;
if(arch && !['arm64','x64'].includes(arch)) throw new Error('PINE_DESK_BUILD_ARCH must be arm64 or x64.');
module.exports={
  ...base,
  forceCodeSigning:false,
  artifactName:'Pine-Desk-${version}-unsigned-${arch}.${ext}',
  mac:{...base.mac,identity:null,notarize:false,target:base.mac.target.map(target=>arch ? {...target,arch:[arch]} : target)},
  publish:null,
  extraResources:[],
};
