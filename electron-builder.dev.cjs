const base=require('./package.json').build;
module.exports={
  ...base,
  forceCodeSigning:false,
  mac:{...base.mac,identity:null,notarize:false},
  publish:null,
  extraResources:[],
};
