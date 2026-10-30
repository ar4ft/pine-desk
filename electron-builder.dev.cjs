const base=require('./package.json').build;
const arch=process.env.PINE_DESK_BUILD_ARCH;
if(arch && !['arm64','x64'].includes(arch)) throw new Error('PINE_DESK_BUILD_ARCH must be arm64 or x64.');
module.exports={
  ...base,
  forceCodeSigning:false,
  artifactName:'Pine-Desk-${version}-unsigned-${arch}.${ext}',
  mac:{...base.mac,identity:null,notarize:false,target:base.mac.target.map(target=>arch ? {...target,arch:[arch]} : target)},
  dmg:{
    window:{width:540,height:400},
    contents:[
      {x:130,y:220,type:'file'},
      {x:410,y:220,type:'link',path:'/Applications'},
      {x:270,y:70,type:'file',path:'build/README-UNSIGNED.txt',name:'READ ME FIRST.txt'},
    ],
  },
  publish:null,
  extraResources:[],
};
