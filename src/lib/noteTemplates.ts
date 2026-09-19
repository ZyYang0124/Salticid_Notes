// 札记版式模板注册表（与 studio-remote/src/index.ts 的 NOTE_TPL_IDS 保持一致）。
// 模板只改版式不改内容：同一 HTML 结构，article 根挂 .tpl-<id> 由 CSS 呈现。
export const NOTE_TEMPLATES: { id: string; name: string; desc: string }[] = [
  { id: 'classic', name: '经典', desc: '衬线长文，现在的默认版式' },
  { id: 'folio', name: '双栏杂志', desc: '宽屏双栏 + 首字下沉，适合长篇' },
  { id: 'dropcap', name: '首字沉金', desc: '陶土红大写首字，小节带字距' },
  { id: 'marginalia', name: '旁注批言', desc: '引文浮动为侧栏批注，正文让位' },
  { id: 'gallery', name: '画册', desc: '通栏大图 + 居中小标题，图为主角' },
  { id: 'field', name: '野外手记', desc: '横线稿纸底 + 等宽小节，田间气质' },
  { id: 'bigtype', name: '大字报', desc: '巨型标题 + 编号小节，海报感' },
  { id: 'quiet', name: '留白', desc: '窄栏居中，去掉一切装饰' },
  { id: 'inversa', name: '夜刊', desc: '墨底纸字反色卡，夜间阅读' },
  { id: 'tiba', name: '题跋', desc: '巨型引号题头，导语斜体衬线' },
];

export const NOTE_TPL_IDS = NOTE_TEMPLATES.map((t) => t.id);

export function noteTemplateOf(v: string | null | undefined): string {
  return v && NOTE_TPL_IDS.includes(v) ? v : 'classic';
}
