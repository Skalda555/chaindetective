import '../server/load-env.mjs';
import {BlockscoutProvider} from '../server/provider.mjs';
import {WalletProviderRouter} from '../server/wallet-provider.mjs';

const tokens=[
 {chainId:'ethereum',symbol:'PEAS',address:'0x02f92800f57bcd74066f5709f1daa1a4302df875'},
 {chainId:'optimism',symbol:'USDC',address:'0x0b2c639c533813f4aa9d7837caf62653d097ff85'},
 {chainId:'robinhood',symbol:'PONS',address:'0x39dbed3a2bd333467115de45665cc57f813c4571'},
];
const key=process.env.BLOCKSCOUT_API_KEY?.trim();
if(!key)throw new Error('BLOCKSCOUT_API_KEY není nastaven; live smoke test se nespustil.');
const rest=new BlockscoutProvider({proApiKey:key});
const router=new WalletProviderRouter({blockscout:rest});
const descending=items=>items.every((item,index)=>index===0||BigInt(items[index-1].value)>=BigInt(item.value));
const addressSet=items=>new Set(items.map(item=>item.address.hash));
const report=[];
for(const token of tokens){
 const route=router.route({kind:'holders',chainId:token.chainId,requestedProvider:'auto'});
 if(route?.provider!=='blockscout_legacy')throw new Error(`${token.chainId}: očekával se Legacy PRO holder route.`);
 const started=Date.now(),first=await router.page({kind:'holders',...token,provider:route.provider,cursor:null});
 if(first.items.length!==1000||first.cursor?.mode!=='blockscout_legacy')throw new Error(`${token.symbol}: Legacy odpověď neměla očekávaných 1000 záznamů a pokračovací cursor.`);
 const second=await router.page({kind:'holders',...token,provider:route.provider,cursor:first.cursor});
 const firstAddresses=addressSet(first.items),duplicates=second.items.filter(item=>firstAddresses.has(item.address.hash)).length;
 const firstDescending=descending(first.items),secondDescending=descending(second.items),orderWithinPages=firstDescending&&secondDescending;
 const orderAcrossPages=BigInt(first.items.at(-1).value)>=BigInt(second.items[0]?.value||'0');
 report.push({network:token.chainId,token:token.symbol,provider:route.provider,pageSize:1000,pagesFetched:2,records:first.items.length+second.items.length,firstPageDescending:firstDescending,secondPageDescending:secondDescending,orderAcrossPages,orderingVerified:orderWithinPages&&orderAcrossPages,duplicateAddresses:duplicates,firstItemRepeatedAtPageBoundary:first.items[0]?.address.hash===second.items[0]?.address.hash&&first.items[0]?.value===second.items[0]?.value,elapsedMs:Date.now()-started});
}
console.log(JSON.stringify({smoke:'Blockscout Legacy PRO holder routing',apiKeyPrinted:false,results:report},null,2));
