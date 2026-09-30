import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const context='Retrieving public indicator metadata and source to support a desktop chart integration and reproducible local trading research workflows.';
export async function libraryCall(name,args={}) {
  if(!['library_search','library_list_indicators','library_get_indicator','library_get_source_code'].includes(name)) throw new Error('Unsupported public library tool.');
  const client=new Client({name:'pine-desk',version:'0.1.0'});
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL('https://mcp.luxalgo.com/mcp')),{timeout:15000});
    const result=await client.callTool({name,arguments:{...args,context}},undefined,{timeout:20000});
    if(result.isError)throw new Error(result.content?.find(c=>c.type==='text')?.text??'Library request failed.');
    if(result.structuredContent)return result.structuredContent;
    const text=result.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n')??'';
    try{return JSON.parse(text);}catch{return {text};}
  } finally {await client.close();}
}
