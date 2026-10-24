export const publicPages = ['/', '/products', '/products/erp', '/products/crm', '/products/mes'] as const;
type Page = typeof publicPages[number];
type Product = 'erp' | 'crm' | 'mes';
const products = {
  erp: {
    name:'ERP 进销存', label:'进销存与经营协作', cardTitle:'从订单到库存，业务有序流转。',
    brief:'把采购、销售、库存和账款放进同一条业务链。',
    title:'订单、库存、账款，<br><em>在同一条业务里。</em>',
    description:'为采购、销售、仓库和财务，提供可协作、可追溯的业务工作台。',
    audience:'采购 · 销售 · 仓库 · 财务', work:'业务单据、履约与账款协作', available:'ERP业务版本，按企业开通',
    tags:['采购与分批入库','销售与库存联动','应收应付与岗位协作'],
    image:'erp-inventory', width:1056, height:550, imageAlt:'ERP库存页面，显示演示商品、企业总库存和可用数量',
    imageLabel:'库存工作台', caption:'在同一工作台查看库存数量与商品记录。',
    features:[['客户与业务资料','维护客户、商品和供应商，让单据有清楚的业务来源。'],['采购与入库','采购单确认、分批入库与库存变动，保留实际履约记录。'],['销售与库存','围绕销售合同与出库跟进履约，核对当前可用库存。'],['应收应付','查看业务形成的账款，跟进收付款与相关记录。'],['审批与岗位流转','按岗位处理待办，在规则与权限内推进业务。'],['业务记录与追溯','从单据、状态和操作记录中核对处理过程。']],
    steps:[['建立业务','整理客户、商品与供应商'],['采购与销售','准备单据，按岗位核对'],['出入库与账款','记录实际履约和款项'],['跟进与复盘','查看状态、异常和业务记录']],
    aiTitle:'查询有事实，操作有确认。', aiText:'用自然语言整理业务问题，结合有权访问的单据和记录准备下一步。',
    ai:[['查询与分析','梳理单据状态、库存和履约问题，区分业务事实与建议。'],['准备业务操作','生成可核对的草稿或操作提案，重要写入由有权人员确认。'],['按企业配置使用','AI需企业启用和有效模型，回答与操作受当前权限限制。']],
    other:'crm', closing:'让业务流转，更清楚一点。',
  },
  crm: {
    name:'电商 CRM', label:'电商客户经营', cardTitle:'从一次购买，到持续的客户关系。',
    brief:'用购买数据找到人群，用运营任务承接下一步。',
    title:'看懂每一次购买，<br><em>经营更长久的关系。</em>',
    description:'为电商品牌与运营团队，连接客户数据、购买洞察和日常运营行动。',
    audience:'品牌运营 · 客户运营 · 运营管理', work:'客户复购、分群与运营任务', available:'人工经营功能，AI助手尚未开放',
    tags:['客户与交易数据','复购指标与客户分群','运营任务与效果复盘'],
    image:'crm-overview', width:1056, height:860, imageAlt:'电商CRM经营概览，显示演示客户的购买与活跃分布',
    imageLabel:'客户经营概览', caption:'把客户、购买指标和活跃分布放在一起看。',
    features:[['客户与交易导入','预览、校验和确认数据，保留批次与处理回执。'],['购买与复购指标','查看净消费、有效订单、复购率与客户活跃情况。'],['客户画像与标签','围绕购买记录、来源与标签了解客户。'],['客户分群','用类型化条件筛选人群，预览名单与实际人数。'],['人工运营任务','将目标、方案、负责人和执行记录放进同一任务。'],['效果观察与复盘','查看目标人群的购买变化，结合实际执行记录复盘。']],
    steps:[['导入数据','预览校验，再确认导入'],['识别人群','按购买行为和指标分群'],['开展运营','确定方案，负责人记录执行'],['查看结果','对照人群与观察窗口复盘']],
    aiTitle:'先把客户经营的基础，做扎实。', aiText:'当前以客户数据、人群、人工任务和效果观察承接日常经营。',
    ai:[['当前可用','客户与交易导入、购买指标、客户分群、人工运营任务和效果报表。'],['后续能力','CRM AI助手尚未开放。外部渠道自动同步、自动群发和会员权益不在当前交付范围。'],['结果按事实观察','报表反映目标人群的实际购买变化，不直接代表营销带来的增量。']],
    other:'erp', closing:'让每一次客户经营，有迹可循。',
  },
  mes: {
    name:'MES 制造执行', label:'制造执行与生产协同', cardTitle:'从BOM到报工，让生产有据可循。',
    brief:'用版本、物料需求和工单，连接计划与现场执行。',
    title:'从计划到现场，<br><em>每一步都有依据。</em>',
    description:'为计划员、生产主管和操作员，连接BOM版本、物料需求、工单与报工审核。',
    audience:'生产计划 · 生产主管 · 现场操作员', work:'BOM版本、物料需求与工单执行', available:'MES业务版本与受控AI助手，按企业开通',
    tags:['BOM与多级需求','计划与工单协作','报工审核与生产进度'],
    image:'mes-production', width:1152, height:980, imageAlt:'MES生产概览，展示演示计划、工单进度、报工审核和合格完成率',
    imageLabel:'生产概览', caption:'已审核报工反馈进度，待审核数量独立显示。',
    features:[['物料与BOM版本','维护产品与组件，发布前核对层级、用量和损耗。'],['多级物料需求','按已发布BOM展开需求，保留计划使用的版本与快照。'],['生产计划','先预览需求，再保存草稿，由有权人员发布计划。'],['工单与受派协作','把计划分配到工序与成员，操作员只处理受派工单。'],['分批报工与审核','区分合格、不良与待审核数量，审核后更新生产进度。'],['生产概览与审计','查看进行中计划、待办和进度，核对关键操作记录。']],
    steps:[['准备BOM','核查物料、用量与版本'],['创建计划','预览需求，保存并人工发布'],['派发与执行','派工、开工并分批报工'],['审核与跟踪','主管审核，回看合格数与进度']],
    aiTitle:'先核对事实，再准备下一步。', aiText:'自然语言查询生产进展、核查BOM，并准备可核对的业务草稿。',
    ai:[['BOM核查','围绕真实行与版本提出用量、损耗风险；确认后保存问题，逐项核实后再发布。'],['生产准备','由系统计算物料需求，再提出BOM或生产计划草稿，写入需要人员确认。'],['现场协作','按岗位范围分析进度与待审核报工。发布、派工、报工和审核由有权人员处理。']],
    other:'erp', closing:'让生产进展，有据可循。',
  },
} as const;
const metadata:Record<Page,{title:string;description:string}>={
  '/':{title:'知行方舟｜让经营有序，让行动有据',description:'知行方舟企业应用平台，提供ERP进销存、电商CRM与MES制造执行，用统一工作入口连接货款流转、客户经营和生产协同。'},
  '/products':{title:'产品中心｜ERP、CRM与MES · 知行方舟',description:'按业务选择知行方舟ERP、电商CRM与MES。管理采购销售库存与账款，经营客户复购，或组织BOM、生产计划、工单与报工。'},
  '/products/erp':{title:'ERP进销存｜采购、销售、库存与账款 · 知行方舟',description:'知行方舟ERP连接客户、采购、销售、库存与应收应付，让不同岗位围绕同一条业务链协作。'},
  '/products/crm':{title:'电商CRM｜从客户数据到复购经营 · 知行方舟',description:'知行方舟电商CRM覆盖客户与交易导入、购买指标、客户分群、运营任务和效果复盘，帮助团队持续经营客户。'},
  '/products/mes':{title:'MES制造执行｜BOM、生产计划、工单与报工 · 知行方舟',description:'知行方舟MES覆盖物料、BOM版本、多级需求、生产计划、工单、报工与审核，AI协助核查BOM和准备待确认草稿。'},
};
const ids=Object.keys(products) as Product[];
const arrow='<span aria-hidden="true">→</span>';
const link=(href:string,label:string,primary=false)=>`<a class="site-button ${primary?'primary':'secondary'}" href="${href}">${label}${arrow}</a>`;
const mark=(app:Product)=>`<span class="app-mark"><img src="/brand/${app}.svg" width="36" height="36" alt=""><span class="sr-only">${app.toUpperCase()}</span></span>`;
const heading=(eyebrow:string,title:string,body='')=>`<div class="section-heading"><p class="eyebrow">${eyebrow}</p><h2>${title}</h2>${body?`<p>${body}</p>`:''}</div>`;
function header(page:Page){return `<a class="skip-link" href="#main-content">跳到主要内容</a><header class="site-header"><div class="site-shell header-inner"><a class="site-brand" href="/" aria-label="知行方舟首页"><img src="/brand/ark.svg" width="36" height="36" alt=""><span><strong>知行方舟</strong><small>企业应用平台</small></span></a><button class="menu-toggle" type="button" aria-label="打开导航" aria-expanded="false" aria-controls="site-nav"><span></span><span></span><span></span></button><nav id="site-nav" class="site-nav" aria-label="官网导航"><a href="/products"${page==='/products'?' aria-current="page"':''}>产品中心</a>${ids.map(id=>`<a href="/products/${id}"${page===`/products/${id}`?' aria-current="page"':''}>${id==='crm'?'电商 CRM':id.toUpperCase()}</a>`).join('')}<a href="/#platform">平台能力</a><a href="/#delivery">交付方式</a><a href="/login" class="nav-login">登录工作区 ${arrow}</a></nav></div></header>`;}
function footer(){return `<footer class="site-footer"><div class="site-shell footer-main"><div><a class="footer-brand" href="/"><img src="/brand/ark.svg" width="32" height="32" alt="">知行方舟</a><p>让经营有序，让行动有据。</p></div><nav aria-label="页脚导航"><a href="/products">产品中心</a>${ids.map(id=>`<a href="/products/${id}">${products[id].name}</a>`).join('')}<a href="/brand/identity.html">品牌标识</a><a href="/register">注册账号</a><a href="/login">登录工作区</a></nav></div><div class="site-shell footer-bottom"><span>© ${new Date().getFullYear()} 知行方舟</span><span>产品画面使用演示数据。应用按企业授权开通。</span></div></footer>`;}
function productCard(id:Product,compact=false){const p=products[id];return `<article class="product-card ${id}"><div class="product-top">${mark(id)}<span class="product-label">${p.label}</span></div><h${compact?'2':'3'}>${p.cardTitle}</h${compact?'2':'3'}><p>${p.brief}</p><ul>${p.tags.map(x=>`<li>${x}</li>`).join('')}</ul><a class="product-link" href="/products/${id}">了解${p.name} ${arrow}</a></article>`;}
function platform(){return `<section class="section platform-section" id="platform"><div class="site-shell">${heading('同一平台，更顺畅的工作','各有专长，协作有章。','按业务选择应用，共用一套企业与成员管理。')}<div class="feature-grid">${[['一个账号，多个应用','在已开通的应用间切换，按岗位进入自己的工作。'],['数据按权限可见','企业、成员和业务范围有清晰边界，关键操作留有记录。'],['知识与工作在一起','企业知识、消息通知与业务应用共用入口，减少来回查找。']].map(([t,d],i)=>`<article><span class="feature-index">0${i+1}</span><h3>${t}</h3><p>${d}</p></article>`).join('')}</div></div></section>`;}
function closing(id?:Product){return `<section class="closing-section"><div class="site-shell closing-inner"><div><p class="eyebrow">从下一件具体的工作开始</p><h2>${id?products[id].closing:'找到适合团队的工作方式。'}</h2><p>注册后创建企业，或接受管理员邀请加入企业。</p></div><div class="closing-actions">${link('/register','注册账号',true)}${link('/login','登录工作区')}</div></div></section>`;}
function home(){return `<section class="home-hero"><div class="site-shell hero-grid"><div class="hero-copy"><p class="eyebrow">知行方舟 · 企业应用平台</p><h1>让经营有序，<br><em>让行动有据。</em></h1><p class="hero-lede">从进销存、客户经营到生产执行，<br class="desktop-break">为团队的每一步工作，提供清晰的业务依据。</p><div class="hero-actions">${link('/products','找到适合你的应用',true)}${link('/login','进入工作区')}</div><p class="hero-caption">ERP 进销存 <span aria-hidden="true">·</span> 电商 CRM <span aria-hidden="true">·</span> MES 制造执行</p></div><figure class="hero-visual"><div class="preview-label"><span><i aria-hidden="true"></i>电商 CRM</span><span>产品实景 · 演示数据</span></div><img src="/marketing/crm-overview.jpg" width="1056" height="860" alt="电商CRM客户经营概览，展示客户数、购买指标和活跃分布" fetchpriority="high" decoding="async"><figcaption>看清客户现状，找到下一步经营方向。</figcaption></figure></div></section><section class="section products-section" id="products"><div class="site-shell">${heading('从业务出发，选择应用','把日常工作，放回清晰的业务里。')}<div class="product-grid">${ids.map(id=>productCard(id)).join('')}</div><p class="section-tail"><a href="/products">查看全部产品 ${arrow}</a></p></div></section>${platform()}<section class="section ai-section"><div class="site-shell split-section"><div>${heading('AI 参与工作','有依据的建议，<br>可核对的操作。')}<p class="section-lede">ERP 与 MES 助手结合当前有权访问的业务事实，协助查询、分析和准备操作。</p><a class="text-link" href="/products/mes#ai">了解 MES 生产助手 ${arrow}</a></div><ol class="principle-list">${[['先看业务事实','结合单据与当前状态，帮助梳理问题。'],['把建议交给你核对','重要写入由有权人员确认，再交给业务规则执行。'],['以实际回执为准','结果回到业务记录中，可查看、可追溯。']].map(([t,d],i)=>`<li><span>0${i+1}</span><div><h3>${t}</h3><p>${d}</p></div></li>`).join('')}</ol></div></section><section class="section delivery-section" id="delivery"><div class="site-shell">${heading('交付方式','按团队的需要，稳步开始。')}<div class="delivery-grid"><article><span class="status available">当前提供</span><h3>标准云服务</h3><p>浏览器访问，按企业与成员授权使用应用。</p></article><article><span class="status planned">按需求评估</span><h3>企业专属环境</h3><p>根据业务、数据与运维要求，评估专属云或企业内部部署。</p></article></div></div></section><section class="section faq-section"><div class="site-shell split-section"><div>${heading('常见问题','开始之前，你可能想了解。')}</div><div class="faq-list">${[['各个应用可以分开使用吗？','可以。ERP管理进销存与账款，电商CRM服务客户经营，MES管理生产执行。企业按需要选择并开通应用，各应用分别管理自己的业务数据。'],['注册后怎样进入企业？','使用账号密码注册、登录，再创建企业或接受管理员邀请加入企业。可见应用和可用功能由企业开通及成员权限决定。'],['电商 CRM 的 AI 功能现在可以用吗？','当前提供客户、导入、分群、人工运营任务和效果报表。CRM AI助手尚未开放。'],['MES 是否已经提供？','MES已提供物料、BOM、计划、工单、报工审核与受控AI草稿。设备接入、工艺质检、自动排程和ERP库存对接不在本期范围。']].map(([t,d])=>`<details><summary>${t}</summary><p>${d}</p></details>`).join('')}</div></div></section>${closing()}`;}
function catalog(){return `<section class="page-intro site-shell"><nav class="breadcrumb" aria-label="面包屑"><a href="/">首页</a><span aria-hidden="true">/</span><span aria-current="page">产品中心</span></nav><p class="eyebrow">产品中心</p><h1>从一项业务，<br><em>开始更好的协作。</em></h1><p>管理货款流转、持续经营客户，或组织生产执行。<br>选择适合团队当前工作的应用。</p></section><section class="catalog-section site-shell"><div class="product-grid">${ids.map(id=>productCard(id,true)).join('')}</div><p class="catalog-note">ERP、CRM、MES 按企业授权开通。CRM 当前提供人工经营功能，AI助手尚未开放。</p></section>${platform()}${closing()}`;}
function product(id:Product){const p=products[id],other=products[p.other];return `<section class="product-hero site-shell"><nav class="breadcrumb" aria-label="面包屑"><a href="/">首页</a><span aria-hidden="true">/</span><a href="/products">产品中心</a><span aria-hidden="true">/</span><span aria-current="page">${p.name}</span></nav><div class="product-hero-grid"><div><p class="eyebrow">${id.toUpperCase()} · ${p.label}</p><h1>${p.title}</h1><p class="hero-lede">${p.description}</p><div class="hero-actions">${link('#capabilities','了解核心能力',true)}${link('/login','登录工作区')}</div></div><div class="product-summary">${mark(id)}<p class="summary-kicker">${p.brief}</p><dl>${[['适用团队',p.audience],['核心工作',p.work],['当前提供',p.available]].map(([t,d])=>`<div><dt>${t}</dt><dd>${d}</dd></div>`).join('')}</dl></div></div></section><section class="section product-preview-section"><div class="site-shell"><figure class="product-preview"><div class="preview-label"><span>${p.name} · ${p.imageLabel}</span><span>当前产品界面 · 演示数据</span></div><img src="/marketing/${p.image}.jpg" width="${p.width}" height="${p.height}" loading="lazy" decoding="async" alt="${p.imageAlt}"><figcaption>${p.caption}</figcaption></figure></div></section><section class="section capabilities-section" id="capabilities"><div class="site-shell">${heading('核心能力',id==='mes'?'把计划和执行，放在同一条工作链。':id==='crm'?'让客户经营，形成日常工作。':'把不同岗位的工作，接起来。')}<div class="capability-grid">${p.features.map(([t,d],i)=>`<article><span class="feature-index">0${i+1}</span><h3>${t}</h3><p>${d}</p></article>`).join('')}</div></div></section><section class="section workflow-section"><div class="site-shell">${heading('一条清晰的工作链',id==='mes'?'从BOM版本，到已审核的产量。':id==='crm'?'从数据进入，到运营复盘。':'从业务发生，到记录落定。')}<ol class="workflow">${p.steps.map(([t,d],i)=>`<li><span>0${i+1}</span><h3>${t}</h3><p>${d}</p></li>`).join('')}</ol></div></section><section class="section ${id==='crm'?'scope-section':'ai-section'}" id="ai"><div class="site-shell split-section"><div>${heading(id==='crm'?'当前交付范围':`${id.toUpperCase()} 业务助手`,p.aiTitle)}<p class="section-lede">${p.aiText}</p></div><div class="plain-list">${p.ai.map(([t,d])=>`<article><h3>${t}</h3><p>${d}</p></article>`).join('')}</div></div></section>${id==='mes'?`<section class="section scope-section"><div class="site-shell split-section"><div>${heading('当前范围','把执行基础，做清楚。')}</div><div class="plain-list"><article><h3>按实际工作推进</h3><p>物料需求不等于可用库存，合格进度以已审核报工为准。</p></article><article><h3>按企业和岗位使用</h3><p>AI需要企业启用、有效模型及岗位授权，建议不能替代工艺和质量判断。</p></article><article><h3>后续能力</h3><p>设备接入、工艺质检、领退料、自动排程与ERP库存对接不在当前交付范围。</p></article></div></div></section>`:''}<section class="section cross-product"><div class="site-shell"><div><p class="eyebrow">也许你还需要</p><h2>${other.cardTitle}</h2></div>${link('/products/'+p.other,'了解'+other.name)}</div></section>${closing(id)}`;}
// JSON-LD values share the visible product registry; no synthetic price, review or rating.
function structuredData(path:Page,origin:string,app:Product|null,image:string){
 const url=origin+path,org=origin+'/#organization',website=origin+'/#website';
 const graph:Record<string,unknown>[]=[
  {'@type':'Organization','@id':org,name:'知行方舟',url:origin+'/',logo:{'@type':'ImageObject',url:origin+'/brand/ark.svg',width:48,height:48}},
  {'@type':'WebSite','@id':website,url:origin+'/',name:'知行方舟',inLanguage:'zh-CN',publisher:{'@id':org}},
  {'@type':path==='/products'?'CollectionPage':'WebPage','@id':url+'#webpage',url,name:metadata[path].title,description:metadata[path].description,inLanguage:'zh-CN',isPartOf:{'@id':website},publisher:{'@id':org},primaryImageOfPage:{'@type':'ImageObject',url:image},...(path!=='/'?{breadcrumb:{'@id':url+'#breadcrumb'}}:{}),...(app?{mainEntity:{'@id':url+'#application'}}:{})},
 ];
 if(path!=='/'){
  const crumbs=[{name:'首页',item:origin+'/'},{name:'产品中心',item:origin+'/products'},...(app?[{name:products[app].name,item:url}]:[])];
  graph.push({'@type':'BreadcrumbList','@id':url+'#breadcrumb',itemListElement:crumbs.map((item,i)=>({'@type':'ListItem',position:i+1,...item}))});
 }
 if(path==='/products')graph.push({'@type':'ItemList','@id':url+'#products',itemListElement:ids.map((id,i)=>({'@type':'ListItem',position:i+1,name:products[id].name,url:origin+'/products/'+id}))});
 if(app){const p=products[app];graph.push({'@type':'SoftwareApplication','@id':url+'#application',name:p.name,url,description:metadata[path].description,applicationCategory:'BusinessApplication',operatingSystem:'Web',inLanguage:'zh-CN',publisher:{'@id':org},image:origin+'/brand/'+app+'.svg',screenshot:image,featureList:p.features.map(([title])=>title)});}
 return JSON.stringify({'@context':'https://schema.org','@graph':graph}).replace(/</g,'\\u003c');
}
export function marketingPage(path:Page){
 const m=metadata[path],origin=new URL(process.env.PUBLIC_SITE_ORIGIN??'https://zhixingark.cn').origin;
 const app=path.startsWith('/products/')?path.split('/').at(-1) as Product:null;
 const share=app?products[app]:products.crm;
 const shareImage=new URL('/marketing/'+share.image+'.jpg',origin).href;
 return `<!doctype html><html lang="zh-CN" data-page="marketing"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#6554D9"><meta name="robots" content="index,follow,max-image-preview:large"><title>${m.title}</title><meta name="description" content="${m.description}"><meta property="og:type" content="website"><meta property="og:locale" content="zh_CN"><meta property="og:site_name" content="知行方舟"><meta property="og:title" content="${m.title}"><meta property="og:description" content="${m.description}"><meta property="og:image" content="${shareImage}"><meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="${share.width}"><meta property="og:image:height" content="${share.height}"><meta property="og:image:alt" content="${share.imageAlt}"><link rel="canonical" href="${origin+path}"><meta property="og:url" content="${origin+path}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${m.title}"><meta name="twitter:description" content="${m.description}"><meta name="twitter:image" content="${shareImage}"><meta name="twitter:image:alt" content="${share.imageAlt}"><link rel="icon" href="/brand/${app??'ark'}.svg" type="image/svg+xml"><link rel="stylesheet" href="/site.css?v=20261023-seo-r1">${path==='/'?'<link rel="preload" as="image" href="/marketing/crm-overview.jpg" fetchpriority="high">':''}<script src="/site.js?v=20261023-seo-r1" defer></script><script type="application/ld+json">${structuredData(path,origin,app,shareImage)}</script></head><body class="marketing">${header(path)}<main id="main-content">${path==='/'?home():path==='/products'?catalog():product(app!)}</main>${footer()}</body></html>`;
}
export function marketingNotFound(){return `<!doctype html><html lang="zh-CN" data-page="marketing"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>页面不存在｜知行方舟</title><link rel="icon" href="/brand/ark.svg" type="image/svg+xml"><link rel="stylesheet" href="/site.css?v=20261023-seo-r1"></head><body class="marketing">${header('/products')}<main id="main-content" class="page-intro site-shell"><p class="eyebrow">404</p><h1>这个页面暂时不存在。</h1><p>你可以返回产品中心，了解当前提供的应用。</p><div class="hero-actions">${link('/products','返回产品中心',true)}${link('/','返回首页')}</div></main>${footer()}<script src="/site.js?v=20261023-seo-r1" defer></script></body></html>`;}
