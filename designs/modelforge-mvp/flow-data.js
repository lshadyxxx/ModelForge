/* Throwaway demo data, not a provider capability claim or a fixed model choice. */
window.MF = {
  nav: [['home','工作台','overview'],['datasets','数据集','data'],['models','模型','model'],['compute','计算环境','compute'],['training','训练','train'],['trial','推理试用','chat']],
  models: [
    { id:'public-small', name:'示例文本模型 · 0.6B', source:'优云公共目录', storage:'外部只读', size:'0.6B', path:'/model/demo-text-0.6b', fingerprint:'demo-base-06b' },
    { id:'public-medium', name:'示例文本模型 · 3B', source:'优云公共目录', storage:'外部只读', size:'3B', path:'/model/demo-text-3b', fingerprint:'demo-base-3b' },
    { id:'managed', name:'自有文本模型 · 1.5B', source:'完整目录上传', storage:'MinIO', size:'1.5B', path:'models/demo-15b/v1', fingerprint:'demo-base-15b' }
  ],
  datasets:[{id:'support-v3',name:'产品助手对话',version:'v3',count:240,published:true},{id:'faq-v1',name:'常见问题样本',version:'v1',count:80,published:true}],
  gpus:[
    {id:'gpu-a',name:'GPU A',memory:'24 GB',cpu:'8 vCPU',ram:'32 GB',price:'2.40',stock:true},
    {id:'gpu-b',name:'GPU B',memory:'48 GB',cpu:'12 vCPU',ram:'64 GB',price:'4.80',stock:true},
    {id:'gpu-c',name:'GPU C',memory:'16 GB',cpu:'8 vCPU',ram:'32 GB',price:'1.80',stock:false}
  ],
  images:[{id:'train-compatible',name:'文本训练环境 · 演示 v1',kind:'训练',compatible:true},{id:'train-unknown',name:'通用 Python 环境 · 演示',kind:'训练',compatible:false},{id:'infer-compatible',name:'vLLM 推理环境 · 演示 v1',kind:'推理',compatible:true}],
  stages:['创建实例','准备输入','检查运行时','执行训练','回传与校验','释放实例'],
  trialStages:['申请独立实例','恢复模型与 Adapter','核对基座指纹','加载 vLLM','检查服务与试推理'],
  defaults:{name:'产品助手 · LoRA 微调',epochs:3,lr:0.0002,sequence:2048,batch:1,accumulation:8,rank:8,alpha:16,dropout:0,scheduler:'cosine',warmup:0.1,validation:10,seed:42},
  trainLoss:[2.54,2.28,2.05,1.91,1.75,1.61,1.50,1.41,1.35,1.29,1.26,1.23]
};
window.MFIcon=function(name,cls=''){
 const paths={overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',data:'M4 5h16v14H4z M4 10h16 M9 10v9',model:'m12 3 9 5-9 5-9-5 9-5z M3 12l9 5 9-5 M3 16l9 5 9-5',compute:'M5 5h14v14H5z M9 9h6v6H9z M8 2v3 M16 2v3 M8 19v3 M16 19v3 M2 8h3 M2 16h3 M19 8h3 M19 16h3',train:'m8 4 12 8-12 8V4z',chat:'M4 4h16v12H9l-5 5V4z',arrow:'M4 12h15 m-5-5 5 5-5 5',back:'M20 12H5 m5-5-5 5 5 5',check:'m5 12 4 4L19 6',close:'m6 6 12 12 M6 18 18 6',plus:'M12 4v16 M4 12h16',refresh:'M20 8a8 8 0 1 0 0 8 M20 3v5h-5',file:'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6',clock:'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M12 8v5l3 2',alert:'m12 3 10 18H2L12 3z M12 9v5 M12 17h.01',upload:'M12 16V3 m-5 5 5-5 5 5 M4 15v6h16v-6',down:'M12 3v13 m-5-5 5 5 5-5 M4 18v3h16v-3',search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14z m5 12 6 6',external:'M14 3h7v7 M21 3l-11 11 M10 3H3v18h18v-7',info:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v6 M12 7h.01',stop:'M5 5h14v14H5z'};
 return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.file}"></path></svg>`;
};