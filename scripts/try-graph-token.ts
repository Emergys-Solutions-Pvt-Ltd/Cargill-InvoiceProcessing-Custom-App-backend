 import {getAccessToken} from '../src/modules/common/mailbox/graph/graph-auth.js';


 async function main()
 {
 const token=await getAccessToken();
 console.log('Token ' , token);
  //console.log('Token ' , token.slice(0,20) );
 console.log('Cached' , await getAccessToken() === token);

}

main();