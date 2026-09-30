import {EditorState} from '@codemirror/state';
import {EditorView,keymap,lineNumbers,highlightActiveLine,highlightSpecialChars,drawSelection} from '@codemirror/view';
import {StreamLanguage,syntaxHighlighting,HighlightStyle,indentOnInput} from '@codemirror/language';
import {tags} from '@lezer/highlight';
import {autocompletion,completionKeymap,snippetCompletion} from '@codemirror/autocomplete';
import {defaultKeymap,history,historyKeymap,indentWithTab} from '@codemirror/commands';
import {searchKeymap,highlightSelectionMatches} from '@codemirror/search';
import {setDiagnostics,lintGutter} from '@codemirror/lint';
const keywords=new Set('if else for while switch break continue return var varip const input simple series import export method type int float bool string color array matrix map true false na and or not'.split(' '));
const language=StreamLanguage.define({
 startState:()=>({quote:null}),
 token(stream,state){
  if(stream.eatSpace())return null;
  if(stream.match('//')){stream.skipToEnd();return 'comment';}
  if(stream.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/))return 'number';
  if(stream.peek()==='"'||stream.peek()==="'"){const quote=stream.next();let escaped=false;while(!stream.eol()){const c=stream.next();if(c===quote&&!escaped)break;escaped=c==='\\'&&!escaped;}return 'string';}
  if(stream.match(/^#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?/))return 'color';
  if(stream.match(/^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*/)){const word=stream.current();return keywords.has(word)?'keyword':word.includes('.')?'variableName.special':'variableName';}
  if(stream.match(/^[+*/%=<>!?:-]+/))return 'operator';stream.next();return null;
 },languageData:{commentTokens:{line:'//'},indentUnit:'    '},
});
const words=['open','high','low','close','volume','time','bar_index','hl2','hlc3','ohlc4','syminfo.mintick','syminfo.tickerid','barstate.isconfirmed','barstate.islast','strategy.long','strategy.short','strategy.position_size','strategy.equity','strategy.percent_of_equity','strategy.commission.percent','color.aqua','color.orange','color.red','color.green','color.teal','display.none','ta.ema','ta.sma','ta.rsi','ta.atr','ta.stdev','ta.crossover','ta.crossunder','ta.highest','ta.lowest','ta.change','ta.macd','ta.bb','math.abs','math.max','math.min','math.round','request.security','input.int','input.float','input.bool','input.string','plot','plotshape','hline','strategy.entry','strategy.close','strategy.exit','indicator','strategy'];
const completions=[...words.map(label=>({label,type:label.includes('.')?'function':'variable'})),...Array.from(keywords,label=>({label,type:'keyword'})),
 snippetCompletion('plot(${series}, "${Title}")',{label:'plot()',type:'function',detail:'Plot a series'}),
 snippetCompletion('input.int(${14}, "${Length}", minval=1)',{label:'input.int()',type:'function',detail:'Integer input'}),
 snippetCompletion('if ta.crossover(${fast}, ${slow})\n    strategy.entry("${Long}", strategy.long)',{label:'crossover entry',type:'keyword',detail:'Long entry rule'}),
];
export function pineCompletions(context){
 const word=context.matchBefore(/[\w.]*/);if(!word||word.from===word.to&&!context.explicit)return null;
 const locals=[...context.state.doc.toString().matchAll(/^\s*(?:(?:var|varip)\s+)?(?:(?:int|float|bool|string)\s+)?([A-Za-z_]\w*)\s*=/gm)].map(match=>({label:match[1],type:'variable'}));
 return {from:word.from,options:[...completions,...locals],validFor:/^[\w.]*$/};
}
const theme=EditorView.theme({
 '&':{height:'100%',fontSize:'12px',backgroundColor:'#0b1420',color:'#c1d5de'},'.cm-scroller':{overflow:'auto',fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',lineHeight:'1.7'},'.cm-content':{padding:'12px 0',caretColor:'#63dfbd'},'.cm-gutters':{backgroundColor:'#0b1420',color:'#516478',border:'none'},'.cm-activeLine':{backgroundColor:'#152333'},'.cm-activeLineGutter':{backgroundColor:'#152333'},'&.cm-focused':{outline:'none'},'.cm-tooltip':{backgroundColor:'#152333',border:'1px solid #33475d',color:'#d1e1ee'},'.cm-selectionBackground, &.cm-focused .cm-selectionBackground':{backgroundColor:'#28465a'},'.cm-cursor':{borderLeftColor:'#63dfbd'},
},{dark:true});
const highlight=HighlightStyle.define([{tag:tags.keyword,color:'#c792ea'},{tag:tags.number,color:'#f4bd78'},{tag:tags.string,color:'#9bd9a1'},{tag:tags.comment,color:'#647c91',fontStyle:'italic'},{tag:tags.special(tags.variableName),color:'#69c9ec'},{tag:tags.operator,color:'#f17789'}]);
export function mountPineEditor(parent,source,onChange){
 const view=new EditorView({parent,state:EditorState.create({doc:source,extensions:[lineNumbers(),highlightActiveLine(),highlightSpecialChars(),drawSelection(),history(),indentOnInput(),language,theme,syntaxHighlighting(highlight),autocompletion({override:[pineCompletions]}),highlightSelectionMatches(),lintGutter(),keymap.of([indentWithTab,...completionKeymap,...defaultKeymap,...historyKeymap,...searchKeymap]),EditorView.contentAttributes.of({'aria-label':'Pine Script editor'}),EditorView.updateListener.of(update=>{if(update.docChanged){queueMicrotask(()=>{if(!view.destroyed)view.dispatch(setDiagnostics(view.state,[]));});onChange(view.state.doc.toString());}})]})});
 return {
  getValue:()=>view.state.doc.toString(),
  setValue:value=>view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value}}),
  diagnostic:diagnostic=>{
    const line=diagnostic?.line;
    if(!Number.isInteger(line)||line<1||line>view.state.doc.lines){view.dispatch(setDiagnostics(view.state,[]));return;}
    const range=view.state.doc.line(line);view.dispatch(setDiagnostics(view.state,[{from:range.from,to:Math.max(range.from,range.to),severity:'error',message:diagnostic.message}]));
  },
  jumpTo:line=>{if(line>=1&&line<=view.state.doc.lines){const from=view.state.doc.line(line).from;view.dispatch({selection:{anchor:from},scrollIntoView:true});view.focus();}},
  destroy:()=>view.destroy(),
 };
}
