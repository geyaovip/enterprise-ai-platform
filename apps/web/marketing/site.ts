import { publicPaths, legacyHashRoutes } from '../../../cloudflare/public-routes.mjs';
import { employeeJobs, jobHref, type EmployeeJob } from './jobs';
import { employees, employeeIds, employeeAvatar, employeeHref, type EmployeeProduct } from './employees';
import { scenarios } from './scenarios';
import { examplePanel, type ExampleId } from './examples';
export const publicPages = publicPaths;
type Page = string;
type Product = EmployeeProduct | 'manufacturing';
const products = {
  erp: {
    name:'ERP 进销存', label:'进销存与经营协作', cardTitle:'从订单到库存，业务有序流转。',
    brief:'把采购、销售、库存和账款放进同一条业务链。',
    title:'订单、库存、账款，<br><em>少一点来回核对。</em>',
    description:'采购、销售、库存、应收应付与审批协作。',
    audience:'采购 · 销售 · 仓库 · 财务', work:'业务单据、履约与账款协作', available:'采购、销售、库存与账款',
    tags:['采购与分批入库','销售与库存联动','应收应付与岗位协作'],
    image:'render-data', width:1200, height:900, imageAlt:'订单与表格核对的紫白色三维场景',
    imageLabel:'库存工作台', caption:'在同一工作台查看库存数量与商品记录。',
    features:[['客户与业务资料','维护客户、商品和供应商，让单据有清楚的业务来源。'],['采购与入库','采购单确认、分批入库与库存变动，保留实际履约记录。'],['销售与库存','围绕销售合同与出库跟进履约，核对当前可用库存。'],['应收应付','查看业务形成的账款，跟进收付款与相关记录。'],['审批与岗位流转','按岗位处理待办，在规则与权限内推进业务。'],['业务记录与追溯','从单据、状态和操作记录中核对处理过程。']],
    steps:[['建立业务','整理客户、商品与供应商'],['采购与销售','准备单据，按岗位核对'],['出入库与账款','记录实际履约和款项'],['跟进与复盘','查看状态、异常和业务记录']],
    aiTitle:'查清业务情况，准备下一步行动。', aiText:'围绕订单、库存与账款，快速梳理需要处理的事项。',
    ai:[['查询业务状态','快速查看订单、库存与履约情况。'],['准备业务操作','整理单据草稿和处理建议。'],['跟进处理结果','查看业务记录，继续推进待办事项。']],
    other:'crm', closing:'让业务流转，更清楚一点。',
  },
  crm: {
    name:'客户 CRM', label:'销售跟进与客户经营', cardTitle:'从一次购买，到持续的客户关系。',
    brief:'用购买数据找到人群，用运营任务承接下一步。',
    title:'客户数据有了，<br><em>下一步该跟进谁？</em>',
    description:'客户与交易导入、销售与服务跟进、分群、运营任务及效果观察。',
    audience:'销售 · 客户运营 · 客户服务 · 负责人', work:'客户复购、分群与运营任务', available:'客户数据、客户分群与运营任务',
    tags:['客户与交易数据','复购指标与客户分群','运营任务与效果复盘'],
    image:'render-followups', width:1200, height:900, imageAlt:'客户沟通与任务跟进的紫白色三维场景',
    imageLabel:'客户经营概览', caption:'把客户、购买指标和活跃分布放在一起看。',
    features:[['客户与交易导入','预览、校验和确认数据，保留批次与处理回执。'],['购买与复购指标','查看净消费、有效订单、复购率与客户活跃情况。'],['客户档案与归属','围绕购买记录、来源与标签了解客户，明确客户负责人。'],['销售与服务跟进','连接线索、商机、跟进和服务待办，记录下一步处理。'],['分群与运营任务','预览目标客户，把方案、负责人、执行与逐客户反馈放进任务。'],['效果观察与复盘','查看目标人群的购买变化，结合实际执行记录复盘。']],
    steps:[['导入数据','预览校验，再确认导入'],['识别人群','按购买行为和指标分群'],['开展运营','确定方案，负责人记录执行'],['查看结果','对照人群与观察窗口复盘']],
    aiTitle:'找准目标客户，跟进运营行动。', aiText:'把客户、购买记录和运营任务放在一起，找到值得跟进的人和事。',
    ai:[['找准目标客户','按购买记录与活跃情况筛选人群。'],['安排运营任务','整理方案、负责人、时间与执行清单。'],['复盘经营变化','结合执行记录，观察目标人群的购买变化。']],
    other:'erp', closing:'让每一次客户经营，有迹可循。',
  },
  mes: {
    name:'MES 制造执行', label:'制造执行与生产协同', cardTitle:'从BOM到报工，让生产有据可循。',
    brief:'用版本、物料需求和工单，连接计划与现场执行。',
    title:'计划在推进，<br><em>进度不用反复追问。</em>',
    description:'物料、BOM版本、生产计划、工单与报工审核。',
    audience:'生产计划 · 生产主管 · 现场操作员', work:'BOM版本、物料需求与工单执行', available:'BOM、生产计划、工单与报工',
    tags:['BOM与多级需求','计划与工单协作','报工审核与生产进度'],
    image:'render-hero', width:1672, height:941, imageAlt:'资料、仓库与团队协作的三维业务场景',
    imageLabel:'生产概览', caption:'已审核报工反馈进度，待审核数量独立显示。',
    features:[['资料整理与BOM版本','从物料表和企业物料资料整理草稿，发布前核对来源、层级、用量和单位。'],['多级物料需求','按已发布BOM展开需求，保留计划使用的版本与快照。'],['生产计划','先预览需求，再保存草稿，由有权人员发布计划。'],['工单与受派协作','把计划分配到工序与成员，操作员只处理受派工单。'],['分批报工与审核','区分合格、不良与待审核数量，审核后更新生产进度。'],['生产概览与审计','查看进行中计划、待办和进度，核对关键操作记录。']],
    steps:[['准备BOM','核查物料、用量与版本'],['创建计划','预览需求，保存并人工发布'],['派发与执行','派工、开工并分批报工'],['审核与跟踪','主管审核，回看合格数与进度']],
    aiTitle:'核对生产资料，跟进现场进度。', aiText:'查询生产进展、梳理BOM问题，准备下一步生产工作。',
    ai:[['BOM核查','检查组件、用量与损耗，集中处理需要核实的问题。'],['生产准备','展开物料需求，准备BOM与生产计划草稿。'],['现场协作','跟踪工单进度、报工与审核，及时发现待办事项。']],
    other:'erp', closing:'让生产进展，有据可循。',
  },
  content: {
    name:'品牌内容', brief:'输入需求、参考改图，下载可用的品牌宣传图片。',
    features:[['需求生图','描述产品、场景与风格，生成完整图片。'],['参考改图','选用已有结果或上传参考，描述需要修改的内容。'],['品牌与产品资料','按需复用品牌风格和产品资料，减少重复输入。'],['创作与交付','查看历史结果、继续修改并下载原图。']],
  },
  geo: {
    name:'GEO 品牌可见度',
    brief:'看品牌在 AI 回答里是否被提及、推荐，以及竞品和引用来源。',
    features:[
      ['监测问题与多模型分析','用实际选购问法建立问题组，选择模型并预估费用。'],
      ['品牌分析报告','查看品牌提及、推荐、竞品与原始回答，直接下载 PDF。'],
      ['竞品与引用证据','定位竞品被提到而本品牌缺席的问题，回看原回答和引用。'],
      ['监测与优化复测','把证据转为优化任务，设置监测计划，沿用基线条件复测。'],
    ],
  },
  manufacturing: {
    name:'制造业进销存',
    brief:'面向按单生产的装配团队，连接接单、采购、仓储、生产与发货。',
    features:[
      ['接单与缺料采购','按 BOM 版本核对可用库存与在途采购，把待补物料带入采购草稿。'],
      ['多仓库存与锁库','办理调拨和盘点，按仓库为订单锁定库存，按安全库存生成补货建议。'],
      ['计划、派工与报工','发布生产计划，分批报工并审核。按合格量和实际领料校验成品入库。'],
      ['批次与序列号追溯','扫码查在库位置、出入库单据以及成品与原料的耗用关系。'],
    ],
  },
} as const;

const ids=Object.keys(products) as Product[];
const mainExample=(id:Exclude<EmployeeProduct,'content'|'geo'>):ExampleId=>id==='mes'?'bom':id==='erp'?'fulfillment':'retention';
const exampleForJob=(job:EmployeeJob)=>job.example&&job.employee!=='content'?mainExample(job.employee):null;
const arrow='<img class="arrow-icon" src="/marketing/arrow-right.svg" width="18" height="18" alt="">';
const link=(href:string,label:string,primary=false)=>`<a class="site-button ${primary?'primary':'secondary'}" href="${href}">${label}${arrow}</a>`;
const textLink=(href:string,label:string)=>`<a class="text-link" href="${href}">${label} ${arrow}</a>`;
const heading=(title:string)=>`<div class="section-heading"><h2>${title}</h2></div>`;
const visual=(name:string,alt:string,cls='',eager=false)=>`<img class="${cls}" src="/marketing/${name}.webp" alt="${alt}" ${eager?'fetchpriority="high"':'loading="lazy"'} decoding="async" width="${name==='render-hero'?1672:name.startsWith('render-flow')?512:1200}" height="${name==='render-hero'?941:name.startsWith('render-flow')?512:name.startsWith('ui-')?800:900}">`;
const productIllustrations:Record<Product,string>={
  erp:'库存货箱、数量刻度和采购单的渲染示意',
  crm:'归入同一回访组的客户卡片渲染示意',
  mes:'拆解零件与待核对的物料清单渲染示意',
  content:'同一产品在两种光线下的创作效果渲染示意',
  geo:'从模型回答中查找品牌提及和引用的渲染示意',
  manufacturing:'沿制造流程排列的原料箱、装配工位和带条码的成品箱',
};
const productArt=(id:Product)=>'/marketing/platform-'+id+'-render.webp';
const productImage=(id:Product)=>`<img class="interface-image" src="${productArt(id)}" width="1200" height="800" alt="${productIllustrations[id]}" loading="lazy" decoding="async">`;
const productPreview=(id:Product)=>`<button type="button" class="interface-preview" data-interface-src="${productArt(id)}" data-interface-title="${products[id].name}产品示意图" aria-label="放大查看${products[id].name}示意图">${productImage(id)}<span>查看示意图</span></button>`;
const metadata:Record<string,{title:string;description:string}>={
 '/':{title:'知行方舟｜企业AI应用与数字员工',description:'连接库存、客户、生产、品牌内容创作和 AI 品牌可见度监测，按企业权限使用业务应用、数字员工和企业知识。'},
 '/employees':{title:'数字员工｜ERP、CRM、MES、品牌内容与 GEO · 知行方舟',description:'了解 ERP 管家、CRM 运营官、MES 生产官、品牌内容创作官与 GEO 品牌分析官的职责和协作场景。'},
 '/solutions':{title:'工作场景｜库存、客户、制造交付与品牌运营 · 知行方舟',description:'查看库存、客户、生产、品牌内容创作与 AI 品牌可见度分析的准备资料、处理步骤与交付结果。'},
 '/products':{title:'业务应用｜制造业进销存、ERP、CRM、MES 与品牌应用 · 知行方舟',description:'了解制造业进销存、ERP、CRM、MES、品牌内容和 GEO，按企业需要选择业务应用。'},
 '/knowledge':{title:'企业知识｜资料查询与原文回查 · 知行方舟',description:'按企业及成员权限查询知识资料，保留原文引用，结合业务记录核对结果。'},
 '/contact':{title:'联系与落地｜知行方舟',description:'从直接使用、现有流程扩展或专属构建开始，围绕业务样例、当前流程和期望结果沟通需求。'},
};
function crumbs(path:string){return [{name:'首页',item:'/'},{name:metadata[path]?.title.split('｜')[0]??'页面不存在',item:path}];}
function breadcrumb(path:string){return `<nav class="breadcrumb" aria-label="面包屑">${crumbs(path).map((c,i,a)=>`${i?'<span aria-hidden="true">/</span>':''}${i===a.length-1?`<span aria-current="page">${c.name}</span>`:`<a href="${c.item}">${c.name}</a>`}`).join('')}</nav>`;}
function header(page:string){const nav=[['/solutions','工作场景'],['/employees','数字员工'],['/products','业务应用'],['/knowledge','企业知识'],['/contact','联系与落地']];return `<a class="skip-link" href="#main-content">跳到主要内容</a><header class="site-header"><div class="site-shell header-inner"><a class="site-brand" href="/" aria-label="知行方舟首页"><img src="/brand/ark.svg" width="36" height="36" alt=""><strong>知行方舟</strong></a><button class="menu-toggle" type="button" aria-label="打开导航" aria-expanded="false" aria-controls="site-nav"><img src="/marketing/menu.svg" width="24" height="24" alt=""></button><nav id="site-nav" class="site-nav" aria-label="官网导航">${nav.map(([href,label])=>`<a href="${href}"${page===href?' aria-current="page"':page.startsWith(href+'/')?' aria-current="true"':''}>${label}</a>`).join('')}<a class="nav-cta" href="/login">前往工作台 ${arrow}</a></nav></div></header>`;}
function footer(){return `<footer class="site-footer"><div class="site-shell footer-main"><div><a class="site-brand" href="/"><img src="/brand/ark.svg" width="32" height="32" alt=""><strong>知行方舟</strong></a><p><a href="mailto:geyaovip@163.com">geyaovip@163.com</a></p></div><nav aria-label="了解知行方舟"><a href="/employees">数字员工</a><a href="/solutions">工作场景</a><a href="/employees#mes-example">协作示例</a><a href="/knowledge">企业知识</a></nav><nav aria-label="业务应用">${ids.map(id=>`<a href="/products#${id}">${products[id].name}</a>`).join('')}</nav><nav aria-label="联系与使用"><a href="/contact">联系与落地</a><a href="/login">前往工作台</a></nav></div><div class="site-shell footer-bottom">© ${new Date().getFullYear()} 知行方舟</div></footer>`;}
function pageIntro(path:string,title:string){return `<section class="site-shell page-heading">${breadcrumb(path)}<div class="page-heading-copy"><h1>${title}</h1></div></section>`;}
const flowImages=['sources','organize','confirm','receipt'];
function workflow(steps:ReadonlyArray<readonly string[]>){return `<ol class="visual-workflow">${steps.map(([t,d],i)=>`<li><div class="flow-art">${visual('render-flow-'+flowImages[i],'', 'flow-image')}</div><h3>${t}</h3><p>${d}</p>${i<3?`<span class="flow-arrow">${arrow}</span>`:''}</li>`).join('')}</ol>`;}
function contactPanel(){return `<section class="contact-panel" aria-labelledby="contact-panel-title"><div class="contact-panel-copy"><h2 id="contact-panel-title">联系咨询</h2><ul class="contact-preparation"><li>业务样例</li><li>当前流程与卡点</li><li>期望交付结果</li></ul></div><div class="contact-panel-action"><p class="contact-email">geyaovip@163.com</p>${link('mailto:geyaovip@163.com','邮件联系',true)}</div></section>`;}
function delivery(){return `<section class="section delivery-section" id="delivery"><div class="site-shell">${heading('选择适合的落地方式')}<div class="delivery-grid">${[['01','直接使用','选择制造业进销存、ERP、CRM、MES 或品牌应用。','/products','选择业务应用'],['02','扩展应用','围绕现有流程，核对需要补充的规则、数据和系统接口。','#contact-panel-title','沟通扩展需求'],['03','专属构建','明确新的工作任务、输入资料和交付物，再评估专属应用。','#contact-panel-title','沟通业务需求']].map(([n,t,d,href,label])=>`<article><span class="step-number">${n}</span><h3>${t}</h3><p>${d}</p>${textLink(href,label)}</article>`).join('')}</div></div></section>`;}
const homeApplications = {
  erp:{title:'知道该补多少货', scenario:'replenishment', action:'查看库存补货场景'},
  crm:{title:'找出这周该回访的客户', scenario:'customer-operations', action:'查看客户回访场景'},
  mes:{title:'在投产前核清物料', scenario:'bom-review', action:'查看 BOM 核查场景'},
  manufacturing:{title:'把制造订单从接单做到发货', scenario:'manufacturing-fulfillment', action:'查看制造履约场景'},
  geo:{title:'看品牌在 AI 回答里怎么被提及', scenario:'brand-visibility', action:'查看品牌分析场景'},
  content:{title:'把产品素材变成宣传图', scenario:'brand-content', action:'查看品牌内容场景'},
} as const;

function applicationFeature(id:Product){
  const item=homeApplications[id];
  return `<article class="application-feature feature-${id}">
    ${productImage(id)}
    <div class="feature-copy">
      <h4>${item.title}</h4>
      ${textLink('/solutions#'+item.scenario,item.action)}
    </div>
  </article>`;
}

const homeSteps = [
  ['提供业务资料','ERP 管家读取有权访问的订单、可用库存与已确认待入库。'],
  ['算清采购缺口','按品项列出缺口和计算依据，方便逐项核对。'],
  ['由负责人确认','采购人员确认数量、供应商和交期。'],
  ['继续处理采购','依据确认结果准备采购草稿，由有权限的人员推进。'],
] as const;

const homeQuestions = [
  ['可以只开通一个应用吗？','可以。企业可以按需要选择应用，开通后由企业管理员为成员分配访问权限。'],
  ['数字员工会直接修改业务记录吗？','涉及业务写入时，平台先展示待确认的内容，由有权限的人员核对并确认。'],
  ['GEO 报告有哪些内容？','报告展示品牌提及、推荐、竞品和原回答引用，可下载 PDF。结果基于所选模型和问题样本。'],
] as const;

function home(){
  return `<section class="platform-hero" aria-labelledby="home-title">
    <div class="site-shell">
      <div class="platform-hero-copy">
        <p class="platform-kicker">企业 AI 应用平台</p>
        <h1 id="home-title">让 AI 查清业务，<br><em>把下一步交给团队</em></h1>
        <div class="platform-actions">${link('#work','查看业务场景',true)}${link('/contact','联系咨询')}</div>
      </div>
      <div class="platform-art"><img src="/marketing/platform-ark-render.webp" width="1536" height="1024" alt="玻璃方舟连接业务资料、数据与待确认结果的概念渲染" fetchpriority="high" decoding="async"></div>
    </div>
  </section>
  <section class="section platform-applications" aria-labelledby="work-title"><div class="site-shell" id="work">
    <div class="section-heading-row"><h2 id="work-title">从你要完成的工作开始</h2>${textLink('/products','全部业务应用')}</div>
    <section class="application-group" aria-labelledby="operation-title"><h3 id="operation-title">经营协作</h3><div class="application-pair">${applicationFeature('erp')}${applicationFeature('crm')}</div></section>
    <section class="application-group" aria-labelledby="production-title"><h3 id="production-title">生产准备与执行</h3><div class="application-pair">${applicationFeature('manufacturing')}${applicationFeature('mes')}</div></section>
    <section class="application-group" aria-labelledby="brand-title"><h3 id="brand-title">品牌运营</h3><div class="application-pair">${applicationFeature('geo')}${applicationFeature('content')}</div></section>
  </div></section>
  <section class="section platform-flow" aria-labelledby="flow-title"><div class="site-shell">
    <div class="section-heading-row"><h2 id="flow-title">从缺料核算到采购草稿</h2>${textLink('/solutions#erp-example','看完整协作示例')}</div>
    <ol class="platform-steps">${homeSteps.map(([title,detail],index)=>`<li><span aria-hidden="true">0${index+1}</span><h3>${title}</h3><p>${detail}</p></li>`).join('')}</ol>
    <div class="platform-flow-links">${textLink('/employees','认识数字员工')}${textLink('/knowledge','了解企业知识')}</div>
  </div></section>
  <section class="section platform-faq" aria-labelledby="faq-title"><div class="site-shell">
    <h2 id="faq-title">常见问题</h2>
    <div class="platform-answers">${homeQuestions.map(([question,answer])=>`<details><summary>${question}</summary><p>${answer}</p></details>`).join('')}</div>
  </div></section>
  <section class="platform-close"><div class="site-shell">
    <h2>带一个业务问题来聊</h2>
    <div class="platform-actions">${link('/contact','联系咨询',true)}${link('/login','前往工作台')}</div>
  </div></section>`;
}
function sectionTabs(scope:string,label:string,items:{id:string;name:string}[],content:(id:string)=>string){return `<div class="site-shell section-browser" data-section-tabs="${scope}"><div class="section-tabs ${scope==='solutions'?'work-tabs':''}" role="tablist" aria-label="${label}">${items.map((item,index)=>`<button type="button" role="tab" id="${scope}-tab-${item.id}" aria-controls="${item.id}" aria-selected="${index===0}" tabindex="${index===0?0:-1}">${item.name}</button>`).join('')}</div>${items.map((item,index)=>`<section class="section-tab-panel" id="${item.id}" role="tabpanel" aria-labelledby="${scope}-tab-${item.id}" tabindex="0"${index?' hidden':''}>${content(item.id)}</section>`).join('')}</div>`;}
function workContent(job:Pick<EmployeeJob,'name'|'inputs'|'steps'|'outputs'|'confirmation'>,level=3){const h='h'+level;return `<div class="solution-layout inline-work"><div class="solution-main"><section class="solution-inputs"><${h}>准备哪些资料</${h}><ul>${job.inputs.map(x=>`<li>${x}</li>`).join('')}</ul></section><section class="solution-process"><${h}>怎么处理</${h}><ol>${job.steps.map(([t,d])=>`<li><strong>${t}</strong><p>${d}</p></li>`).join('')}</ol></section></div><aside class="solution-result" aria-label="${job.name}交付结果"><${h}>拿到什么结果</${h}><ul>${job.outputs.map(x=>`<li>${x}</li>`).join('')}</ul><div class="confirmation-block"><strong>人员确认</strong><p>${job.confirmation}</p></div></aside></div>`;}
function embeddedExample(id:EmployeeProduct,prefix:string){if(id==='geo')return geoExample();if(id==='content')return contentExamples();return `<section class="inline-example" id="${id}-example"><h3>协作示例</h3>${examplePanel(mainExample(id),prefix,false,true)}</section>`;}
function employeePanel(id:EmployeeProduct){
  const employee=employees[id];
  const jobs=id==='geo'?[geoEmployeeWork]:employeeJobs.filter(job=>job.employee===id);
  const action=id==='content'?link('/contact','申请开通',true):id==='geo'?link('/products#geo','查看 GEO 应用',true):link('/login','前往工作台',true);
  return `<div class="section-profile"><div><div class="section-profile-title"><img class="employee-avatar" src="${employeeAvatar(id)}" width="64" height="64" alt=""><div><h2>${employee.name}</h2><p>${employee.role}</p></div></div>
    <p class="profile-summary">${employee.summary}</p><div class="hero-actions">${action}${link('#'+id+'-example',id==='content'?'看生成与修改示例':'看协作示例')}</div></div>${productPreview(id)}</div>
    <section class="employee-inline-work" id="${id}-work"><h3>负责的工作</h3><div class="employee-work-list">
      ${jobs.map(job=>`<section class="employee-work" id="${job.id}" aria-labelledby="work-title-${job.id}"><header class="employee-work-heading"><h4 id="work-title-${job.id}">${job.name}</h4>${'request' in job?`<p>${job.request}</p>`:''}</header>${workContent(job,5)}</section>`).join('')}
    </div></section>${embeddedExample(id,'employee-'+id)}`;
}
function employeeDirectory(){return `${pageIntro('/employees','数字员工')}${sectionTabs('employees','选择数字员工',employeeIds.map(id=>({id,name:employees[id].name})),id=>employeePanel(id as EmployeeProduct))}`;}

const contentWork = employeeJobs.find(job=>job.id==='brand-content')!;
function contentExamples(){return `<section class="inline-example content-examples" id="content-example"><h3>生成与修改示例</h3><div class="content-example-grid">${[['content-original','首次生成'],['content-edited','参考改图']].map(([asset,title])=>`<figure><img src="/marketing/${asset}.webp" width="2048" height="2048" loading="lazy" decoding="async" alt="${title}：暖冬咖啡宣传图片，AI生成的虚构品牌示例"><figcaption>${title}</figcaption></figure>`).join('')}</div><p class="example-note">${employees.content.name} · AI 生成示例 · 虚构品牌</p></section>`;}
function contentScenario(){return `<header class="inline-solution-heading"><h2>${contentWork.name}</h2>${textLink('#content-example','看生成与修改示例')}</header>${workContent(contentWork)}${contentExamples()}<div class="inline-action">${link('/products#content','查看品牌内容应用',true)}</div>`;}
function brandContentPanel(){return `<div class="section-profile"><div><h2>品牌内容</h2><p class="profile-summary">为营销、电商与销售团队创作品牌宣传图片和短视频。</p><p class="audience">生图与改图 · 图生视频 · 画布与素材管理</p><div class="hero-actions">${link('/contact','申请开通',true)}${link('/solutions#brand-content','查看创作流程')}</div></div>${productPreview('content')}</div><section class="inline-capabilities brand-content-capabilities"><h3>业务功能</h3><div class="capability-grid">${products.content.features.map(([t,d])=>`<article><h4>${t}</h4><p>${d}</p></article>`).join('')}</div></section>${contentExamples()}`;}

const geoWork = {
  id: 'brand-visibility',
  name: '品牌可见度分析',
  inputs: ['品牌名、主要产品或服务', '客户常用的选购问题、重点竞品'],
  steps: [
    ['建立基线', '选择监测问题与模型，确认费用后发起分析。'],
    ['核对回答', '找到竞品出现而品牌缺席的问题，查看原始回答与引用。'],
    ['跟进优化', '分配优化任务，完成后沿用基线条件复测。'],
  ],
  outputs: ['可下载的品牌分析 PDF', '带回答证据的优化任务与复测记录'],
  confirmation: '核对样本覆盖和原回答。结果来自模型 API 抽样，样本不足时仅供诊断。',
} satisfies Pick<EmployeeJob, 'id' | 'name' | 'inputs' | 'steps' | 'outputs' | 'confirmation'>;

const geoEmployeeWork = {
  id: 'geo-report-review',
  name: '报告解读与复测准备',
  inputs: ['已完成的品牌分析报告'],
  steps: [
    [employees.geo.tasks[0], '区分提及、推荐和样本限制。'],
    [employees.geo.tasks[1], '核对缺席问题、对应回答片段和引用。'],
    [employees.geo.tasks[2], '列出优化重点，核对原问题组、模型和地区等复测条件。'],
  ],
  outputs: employees.geo.outputs,
  confirmation: employees.geo.confirmation,
} as const;

function geoExample() {
  return `<section class="inline-example" id="geo-example">
    <h3>协作示例</h3>
    <p>净水品牌团队监测“三口之家有哪些净水品牌可以考虑？”，从回答里核对品牌被推荐的依据，再将需要补充的官网信息转为优化任务。</p>
    <p class="example-note">虚构品牌与测试回答。报告展示的是模型 API 抽样结果。</p>
  </section>`;
}

function geoPanel() {
  const product = products.geo;
  return `<div class="section-profile">
    <div><h2>${product.name}</h2><p class="profile-summary">${product.brief}</p>
      <div class="hero-actions">${link('/contact','申请开通',true)}${link('/solutions#brand-visibility','查看分析流程')}</div>
    </div>${productPreview('geo')}
  </div>
  <section class="inline-capabilities"><h3>业务功能</h3><div class="capability-grid">${product.features.map(([title,description])=>`<article><h4>${title}</h4><p>${description}</p></article>`).join('')}</div></section>
  ${geoExample()}`;
}

function geoScenario() {
  return `<header class="inline-solution-heading"><h2>${geoWork.name}</h2>${textLink('#geo-example','看协作示例')}</header>
    ${workContent(geoWork)}${geoExample()}
    <div class="inline-action">${link('/products#geo','查看 GEO 应用',true)}</div>`;
}

const manufacturingWork = {
  id:'manufacturing-fulfillment',
  name:'制造订单交付',
  inputs:['客户订单与交付日期', '成品 BOM、仓库库存和在途采购'],
  steps:[
    ['核对缺料','按订单 BOM 和作业仓库查看实存、锁定和可用量。'],
    ['补货与领料','采购处理缺料，仓库按实收和实际领用记录出入库。'],
    ['完工与发货','审核报工，分批办理合格品入库和发货。'],
  ],
  outputs:['订单、采购和库存单据', '已入库与已发货数量', '批次和序列号的流转记录'],
  confirmation:'采购审核、报工审核与实际出入库由相应岗位办理。',
} as const;
function manufacturingExample(){
  return `<section class="inline-example" id="manufacturing-example"><h3>协作示例</h3>
    <p>装配团队接到 10 件控制模块订单。计划员按 BOM 核对待补物料，采购分批收货，仓库记录领料和成品入库，销售据实跟进两批发货。</p>
    <p class="example-note">虚构订单，数量用于说明流程。</p></section>`;
}
function manufacturingPanel(){
  const product=products.manufacturing;
  return `<div class="section-profile"><div><h2>${product.name}</h2><p class="profile-summary">${product.brief}</p>
    <p class="audience">销售 · 采购 · 仓库 · 车间</p>
    <div class="hero-actions">${link('/contact','申请开通',true)}${link('/solutions#manufacturing-fulfillment','查看交付流程')}</div>
    </div>${productPreview('manufacturing')}</div>
    <section class="inline-capabilities"><h3>业务功能</h3><div class="capability-grid">${product.features.map(([title,detail])=>`<article><h4>${title}</h4><p>${detail}</p></article>`).join('')}</div></section>
    ${manufacturingExample()}
    <section class="inline-example"><h3>WorkBuddy 制造进销存专家</h3>
      <p>连接授权企业后，可查询订单履约、缺料、生产进度和批次流向。业务操作由相应岗位在工作台办理。</p></section>`;
}

function solutionPanel(id:string){
  if(id===manufacturingWork.id)return `<header class="inline-solution-heading"><h2>${manufacturingWork.name}</h2></header>
    ${workContent(manufacturingWork)}${manufacturingExample()}
    <div class="inline-action">${link('/products#manufacturing','查看制造业进销存',true)}</div>`;
  if(id===geoWork.id)return geoScenario();
  if(id==='brand-content')return contentScenario();
  const job=employeeJobs.find(j=>j.id===id)!;
  const example=exampleForJob(job);
  return `<header class="inline-solution-heading"><h2>${job.name}</h2><p>${job.request}</p>
    ${example?textLink('#'+job.employee+'-example','看协作示例'):''}</header>
    ${workContent(job)}${example?embeddedExample(job.employee,'solution-'+job.id):''}
    <div class="inline-action">${link('/products#'+job.employee,'查看 '+products[job.employee].name,true)}</div>`;
}

function jobsDirectory(){return `${sectionTabs('solutions','选择工作场景',[...employeeJobs.map(j=>({id:j.id,name:j.id==='brand-content'?'品牌创作':j.name})),{id:geoWork.id,name:'品牌可见度'},{id:manufacturingWork.id,name:manufacturingWork.name}],solutionPanel)}`;}
function productPanel(id:Product){if(id==='manufacturing')return manufacturingPanel();if(id==='geo')return geoPanel();if(id==='content')return brandContentPanel();const p=products[id];return `<div class="section-profile"><div><h2>${p.name}</h2><p class="profile-summary">${p.description}</p><p class="audience">${p.audience}</p><div class="hero-actions">${link('/login','前往工作台',true)}${link('#'+id+'-example','看协作示例')}</div></div>${productPreview(id)}</div><section class="inline-capabilities"><h3>业务功能</h3><div class="capability-grid">${p.features.map(([t,d])=>`<article><h4>${t}</h4><p>${d}</p></article>`).join('')}</div></section><section class="inline-workflow"><h3>业务如何衔接</h3>${workflow(p.steps).replaceAll('<h3>','<h4>').replaceAll('</h3>','</h4>')}</section>${embeddedExample(id,'product-'+id)}`;}
function productCatalog(){return `${pageIntro('/products','业务应用')}${sectionTabs('products','选择业务应用',ids.map(id=>({id,name:products[id].name})),id=>productPanel(id as Product))}`;}
function knowledgePage(){const k=scenarios.find(s=>s.id==='knowledge')!;return `${pageIntro('/knowledge','企业知识')}<section class="section directory-section"><div class="site-shell solution-layout"><div class="solution-main"><section class="solution-inputs"><h2>准备哪些资料</h2><ul>${k.inputs.map(x=>`<li>${x}</li>`).join('')}</ul></section><section class="solution-process"><h2>怎么查询</h2><ol>${k.steps.map(([t,d])=>`<li><h3>${t}</h3><p>${d}</p></li>`).join('')}</ol></section></div><aside class="solution-result"><h2>查询结果</h2><ul>${k.outputs.map(x=>`<li>${x}</li>`).join('')}</ul><div class="confirmation-block"><h3>访问与核对</h3><p>${k.confirmation}</p></div>${link('/login','前往工作台',true)}</aside></div></section>`;}
function contactPage(){return `${pageIntro('/contact','联系与落地')}<section class="section directory-section"><div class="site-shell">${contactPanel()}</div></section>${delivery()}`;}
function pageBody(path:string){if(path==='/')return home();if(path==='/employees')return employeeDirectory();if(path==='/solutions')return pageIntro(path,'工作场景')+jobsDirectory();if(path==='/products')return productCatalog();if(path==='/knowledge')return knowledgePage();return contactPage();}
function structuredData(path:string,origin:string,image:string){
 const url=origin+path,org=origin+'/#organization',website=origin+'/#website';
 const graph:Record<string,unknown>[]=[{'@type':'Organization','@id':org,name:'知行方舟',url:origin+'/',email:'geyaovip@163.com',logo:{'@type':'ImageObject',url:origin+'/brand/ark.svg',width:48,height:48}},{'@type':'WebSite','@id':website,url:origin+'/',name:'知行方舟',inLanguage:'zh-CN',publisher:{'@id':org}},{'@type':['/employees','/solutions','/products'].includes(path)?'CollectionPage':'WebPage','@id':url+'#webpage',url,name:metadata[path].title,description:metadata[path].description,inLanguage:'zh-CN',isPartOf:{'@id':website},publisher:{'@id':org},primaryImageOfPage:{'@type':'ImageObject',url:image},...(path!=='/'?{breadcrumb:{'@id':url+'#breadcrumb'}}:{}),...(path==='/products'?{mainEntity:ids.map(id=>({'@id':url+'#application-'+id}))}:{})}];
 if(path!=='/')graph.push({'@type':'BreadcrumbList','@id':url+'#breadcrumb',itemListElement:crumbs(path).map((c,i)=>({'@type':'ListItem',position:i+1,name:c.name,item:origin+c.item}))});
 const items=path==='/products'?ids.map(id=>({name:products[id].name,url:origin+'/products#'+id})):path==='/employees'?employeeIds.map(id=>({name:employees[id].name,url:origin+employeeHref(id)})):path==='/solutions'?[...employeeJobs.map(j=>({name:j.name,url:origin+jobHref(j)})),{name:geoWork.name,url:origin+'/solutions#'+geoWork.id},{name:manufacturingWork.name,url:origin+'/solutions#'+manufacturingWork.id}]:null;
 if(items)graph.push({'@type':'ItemList','@id':url+'#directory',itemListElement:items.map((item,i)=>({'@type':'ListItem',position:i+1,...item}))});
 if(path==='/products')for(const id of ids){const p=products[id];graph.push({'@type':'SoftwareApplication','@id':url+'#application-'+id,name:p.name,url:url+'#'+id,description:p.brief,applicationCategory:'BusinessApplication',operatingSystem:'Web',inLanguage:'zh-CN',publisher:{'@id':org},image:origin+productArt(id),featureList:p.features.map(f=>f[0])});}
 return JSON.stringify({'@context':'https://schema.org','@graph':graph}).replace(/</g,'\\u003c');
}
export function marketingPage(path:Page){
 if(!publicPages.includes(path))return marketingNotFound();
 const m=metadata[path],origin=new URL(process.env.PUBLIC_SITE_ORIGIN??'https://zhixingark.cn').origin;
 const share={image:'platform-ark-render',width:1536,height:1024,imageAlt:'知行方舟企业 AI 应用平台概念渲染'};
 const shareImage=new URL('/marketing/'+share.image+'.webp',origin).href;
 return `<!doctype html><html lang="zh-CN" data-page="marketing"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#6554D9"><meta name="robots" content="index,follow,max-image-preview:large"><title>${m.title}</title><meta name="description" content="${m.description}"><meta property="og:type" content="website"><meta property="og:locale" content="zh_CN"><meta property="og:site_name" content="知行方舟"><meta property="og:title" content="${m.title}"><meta property="og:description" content="${m.description}"><meta property="og:image" content="${shareImage}"><meta property="og:image:type" content="image/webp"><meta property="og:image:width" content="${share.width}"><meta property="og:image:height" content="${share.height}"><meta property="og:image:alt" content="${share.imageAlt}"><link rel="canonical" href="${origin+path}"><meta property="og:url" content="${origin+path}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${m.title}"><meta name="twitter:description" content="${m.description}"><meta name="twitter:image" content="${shareImage}"><meta name="twitter:image:alt" content="${share.imageAlt}"><link rel="icon" href="/brand/ark.svg" type="image/svg+xml"><link rel="stylesheet" href="/site.css?v=20261110-manufacturing-r1"><script id="legacy-routes" type="application/json">${JSON.stringify(legacyHashRoutes[path]??{})}</script><script src="/site.js?v=20261110-manufacturing-r1" defer></script><script type="application/ld+json">${structuredData(path,origin,shareImage)}</script></head><body class="marketing">${header(path)}<main id="main-content">${pageBody(path)}</main>${footer()}<dialog class="interface-dialog" aria-labelledby="interface-dialog-title"><div class="interface-dialog-header"><h2 id="interface-dialog-title">产品示意图</h2><button type="button" class="interface-dialog-close" aria-label="关闭大图"><img src="/marketing/close.svg" width="24" height="24" alt=""></button></div><img class="interface-dialog-image" width="1200" height="800" alt=""></dialog></body></html>`;
}
export function marketingNotFound(){return `<!doctype html><html lang="zh-CN" data-page="marketing"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>页面不存在｜知行方舟</title><link rel="icon" href="/brand/ark.svg" type="image/svg+xml"><link rel="stylesheet" href="/site.css?v=20261110-manufacturing-r1"></head><body class="marketing">${header('')}<main id="main-content" class="page-intro site-shell"><h1>页面不存在</h1><div class="hero-actions">${link('/','返回首页',true)}${link('/employees','查看数字员工')}</div></main>${footer()}<script src="/site.js?v=20261110-manufacturing-r1" defer></script></body></html>`;}
