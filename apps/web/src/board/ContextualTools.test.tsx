// @vitest-environment happy-dom
import { createElement, newTable } from '@inkadra/canvas-core';
import { createBoardDoc, type Element, readElement, roots } from '@inkadra/doc-schema';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ContextualTools } from './ContextualTools.tsx';
import { BoardContext, type BoardContextValue } from './context.ts';
import { BoardStore } from './store.ts';

vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
async function mount(type:'link'|'table',readOnly=false) {
  const doc = createBoardDoc('boardAAAAAAAA');
  const element = type === 'link' ? createElement(doc,'link',{x:0,y:0},{url:'https://youtu.be/dQw4w9WgXcQ',title:'Video'},{userId:null}) : createElement(doc,'table',{x:0,y:0},newTable(1,1),{userId:null});
  const store = new BoardStore(doc);
  const context = {store,readOnly,setCropping:vi.fn()} as unknown as BoardContextValue;
  const host = document.createElement('div');document.body.append(host);
  const root = createRoot(host);
  const render = async () => { const current=readElement(roots(doc).elements.get(element.id)!)!; await act(async () => root.render(<BoardContext.Provider value={context}><ContextualTools element={current} editor={null}/></BoardContext.Provider>)); };
  await render();
  return {host,doc,element,render,async cleanup(){await act(async()=>root.unmount());host.remove();store.destroy();doc.destroy();}};
}
it('keeps video information and preview independent without removing metadata',async()=>{
  const view=await mount('link');
  try {
    const info=view.host.querySelector<HTMLButtonElement>('[role=switch]')!;
    await act(async()=>info.click());await view.render();
    let current=readElement(roots(view.doc).elements.get(view.element.id)!) as Extract<Element,{type:'link'}>;
    expect(current.showInfo).toBe(false);expect(current.showPreview).toBeUndefined();expect(current.title).toBe('Video');
    const preview=view.host.querySelectorAll<HTMLButtonElement>('[role=switch]')[1]!;
    await act(async()=>preview.click());await view.render();
    current=readElement(roots(view.doc).elements.get(view.element.id)!) as Extract<Element,{type:'link'}>;
    expect(current.showPreview).toBe(false);expect(current.showInfo).toBe(false);
  } finally {await view.cleanup();}
});
it('exposes no mutation controls to a read-only viewer',async()=>{
  const view=await mount('link',true);try{expect(view.host.querySelector('button')).toBeNull();}finally{await view.cleanup();}
});
it('disables deleting table rows without a valid cell and at the minimum size',async()=>{
  const view=await mount('table');try {
    const remove=view.host.querySelector<HTMLButtonElement>('[aria-label="board.table.deleteRow"]');
    expect(remove?.disabled).toBe(true);
  }finally{await view.cleanup();}
});
