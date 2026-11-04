import {useEffect, useRef} from 'react';
import type {AdapterVersion} from '../../models';
import type {RuntimeBaseline} from '../../runtime';
import type {Message} from '../conversation';
import {shortId, trialPresentation} from '../serving-model';
import type {ServingTrial, TrialViewState} from '../types';
import {CurrentTrialHeader} from './CurrentTrialHeader';
import {ServingIcon} from './ServingIcon';

const suggestedPrompts = [
  '请用三条要点说明你在这个 Adapter 中学到的表达方式。',
  '请严格依据已知信息回答：你的基座模型和 Adapter 身份是什么？',
  '请写一段 80 字以内的客服回复，并说明语气选择。',
];

function StageRail({view}: {view: TrialViewState}) {
  const index = view.kind === 'queued' ? 0 : view.kind === 'waiting_instance' ? 1 : 2;
  return <ol className="serving-stage-rail" aria-label="推理准备阶段">
    {['已入队', '实例就绪', '推理探测'].map((label, item) => <li
      key={label}
      className={item < index ? 'is-done' : item === index ? 'is-current' : ''}
      aria-current={item === index ? 'step' : undefined}
    >
      <span>{item < index ? <ServingIcon name="check" size={12}/> : item + 1}</span>
      <strong>{label}</strong>
    </li>)}
  </ol>;
}

function WaitingPanel({
  view,
  trial,
  onOpenBind,
  onRefresh,
}: {
  view: TrialViewState;
  trial: ServingTrial;
  onOpenBind: () => void;
  onRefresh: () => void;
}) {
  if (!['queued', 'waiting_instance', 'preparing'].includes(view.kind)) return null;
  const presentation = trialPresentation(view);
  return <section className={`serving-entry-state ${presentation.tone}`}>
    <span className="serving-entry-icon"><ServingIcon
      name={view.kind === 'queued' ? 'clock' : view.kind === 'preparing' ? 'activity' : 'gpu'}
      size={24}
    /></span>
    <div>
      <span className="serving-kicker">{view.kind === 'waiting_instance' ? 'ACTION REQUIRED' : 'LIFECYCLE IN PROGRESS'}</span>
      <h3>{presentation.label}</h3>
      <p>{presentation.description}</p>
      <StageRail view={view}/>
      <div className="serving-inline-actions">
        {view.kind === 'waiting_instance' && <button type="button" onClick={onOpenBind}>关联已创建的实例 <ServingIcon name="arrow" size={14}/></button>}
        <button type="button" className="secondary" onClick={onRefresh}><ServingIcon name="refresh" size={14}/>刷新状态</button>
      </div>
    </div>
    {view.kind === 'waiting_instance' && <div className="serving-instance-brief">
      <span>冻结要求</span>
      <strong>{trial.snapshot.instance.gpu_type || '单 GPU'}</strong>
      <small>{trial.snapshot.instance.region || '地域待读取'} · {trial.snapshot.instance.zone || '可用区待读取'}</small>
      <small>{trial.snapshot.instance.cpu || '—'} 核 · {trial.snapshot.instance.memory_mb ? `${trial.snapshot.instance.memory_mb / 1024} GiB` : '内存待读取'}</small>
    </div>}
  </section>;
}

function BlockedPanel({trial, onRefresh}: {trial: ServingTrial; onRefresh: () => void}) {
  return <section className="serving-entry-state danger">
    <span className="serving-entry-icon"><ServingIcon name="alert" size={24}/></span>
    <div>
      <span className="serving-kicker">OPERATOR ACTION</span>
      <h3>这次试用需要人工处理</h3>
      <p>远端运行时已退出，或生命周期出现不一致。平台不会把当前实例标记为已回收。</p>
      <dl className="serving-inline-facts">
        <div><dt>错误码</dt><dd><code>{trial.error_code || '未提供'}</code></dd></div>
        <div><dt>实例</dt><dd><code>{trial.instance_id || '尚未关联'}</code></dd></div>
      </dl>
      <div className="serving-inline-actions">
        <button type="button" onClick={onRefresh}><ServingIcon name="refresh" size={14}/>重新核对状态</button>
        <a className="serving-secondary-link" href="#compute">查看计算环境</a>
      </div>
    </div>
  </section>;
}

function EndedPanel({
  trial,
  view,
  onCreate,
}: {
  trial: ServingTrial;
  view: TrialViewState;
  onCreate: () => void;
}) {
  if (view.kind !== 'ended') return null;
  const complete = view.receipt === 'complete';
  const noInstance = view.receipt === 'no_instance';
  return <section className={'serving-entry-state ' + (complete ? 'success' : noInstance ? 'neutral' : 'warning')}>
    <span className="serving-entry-icon"><ServingIcon name={complete ? 'check' : noInstance ? 'history' : 'alert'} size={24}/></span>
    <div>
      <span className="serving-kicker">TRIAL CLOSED</span>
      <h3>{complete ? '实例回收闭环已完成' : noInstance ? '试用结束，没有占用云实例' : '试用已结束，回收事实待核对'}</h3>
      <p>{complete
        ? '进程退出、实例删除、清理确认和 GPU 租约释放均有记录。这里只能证明这次受控试用，不代表训练模块状态。'
        : noInstance
          ? '没有云实例或 GPU 租约遗留，可以安全结束。'
          : '停止请求已经结束 Trial，但四项回收事实尚未全部成立。请在右侧运行事实中核对，不能把当前状态当作实例已删除。'}</p>
      <div className="serving-inline-actions">
        <button type="button" onClick={onCreate}><ServingIcon name="plus" size={14}/>创建新的试用</button>
        {!complete && !noInstance && <a className="serving-secondary-link" href="#compute">前往计算环境核对</a>}
      </div>
    </div>
  </section>;
}

function ConversationEmpty({onPrompt}: {onPrompt: (value: string) => void}) {
  return <div className="serving-conversation-empty">
    <span className="serving-empty-orb"><ServingIcon name="spark" size={23}/></span>
    <div>
      <span className="serving-kicker">SESSION STARTS HERE</span>
      <h3>先验证它是否真的会回答</h3>
      <p>会话只保存在当前页面。关闭、刷新或切换 Trial 后清空，不写入 PostgreSQL。</p>
    </div>
    <div className="serving-prompt-grid">
      {suggestedPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => onPrompt(prompt)}>
        <ServingIcon name="arrow" size={13}/><span>{prompt}</span>
      </button>)}
    </div>
  </div>;
}

export function ServingSession({
  trial,
  view,
  adapter,
  runtime,
  runtimeError,
  stale,
  lastLoadedAt,
  messages,
  text,
  sending,
  cancelling,
  actionError,
  maxTokens,
  temperature,
  topP,
  onText,
  onMaxTokens,
  onTemperature,
  onTopP,
  onSend,
  onStop,
  onClear,
  onOpenBind,
  onCreate,
  onRefresh,
}: {
  trial: ServingTrial;
  view: TrialViewState;
  adapter?: AdapterVersion;
  runtime: RuntimeBaseline | null;
  runtimeError: string;
  stale: boolean;
  lastLoadedAt: string;
  messages: Message[];
  text: string;
  sending: boolean;
  cancelling: boolean;
  actionError: string;
  maxTokens: number;
  temperature: number;
  topP: number;
  onText: (value: string) => void;
  onMaxTokens: (value: number) => void;
  onTemperature: (value: number) => void;
  onTopP: (value: number) => void;
  onSend: () => void;
  onStop: () => void;
  onClear: () => void;
  onOpenBind: () => void;
  onCreate: () => void;
  onRefresh: () => void;
}) {
  const messagesRef = useRef<HTMLDivElement>(null);
  const presentation = trialPresentation(view);
  const activeConversation = ['ready', 'generating', 'cancelling', 'request_unknown'].includes(view.kind)
    || (view.kind === 'ended' && messages.length > 0);
  const composerReason = stale
    ? '当前详情已过期，请先刷新再发送。'
    : runtimeError
      ? '推理运行时基线未载入，不能发送。'
      : view.kind === 'generating' || sending
        ? '当前请求尚未结束。'
        : view.kind === 'cancelling' || cancelling
          ? '正在等待停止确认。'
          : view.kind === 'request_unknown'
            ? '上次生成结果未知，后台核对完成前禁止再次发送。'
            : view.kind !== 'ready'
              ? presentation.description
              : !text.trim()
                ? '输入一条消息后发送。'
                : '';
  const canSend = !composerReason && Boolean(runtime) && Boolean(text.trim());

  useEffect(() => {
    if (!activeConversation) return;
    const element = messagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [activeConversation, messages]);

  return <section className="serving-column serving-main" aria-label="当前试用会话">
    <CurrentTrialHeader
      trial={trial}
      view={view}
      adapter={adapter}
      stale={stale}
      lastLoadedAt={lastLoadedAt}
      onRefresh={onRefresh}
    />
    <div className="serving-main-body">
      <div className={`serving-state-banner ${presentation.tone}`} role="status" aria-live="polite">
        <span><ServingIcon name={
          presentation.tone === 'danger' ? 'alert'
            : presentation.tone === 'success' ? 'check'
              : presentation.tone === 'warning' ? 'clock'
                : presentation.tone === 'info' ? 'activity'
                  : 'info'
        } size={17}/></span>
        <div><strong>{presentation.label}</strong><p>{presentation.description}</p></div>
        {view.kind === 'generating' && <span className="serving-live-indicator"><i/>流式输出中</span>}
      </div>
      {actionError && <div className="serving-inline-error" role="alert">
        <ServingIcon name="alert" size={16}/><span>{actionError}</span>
      </div>}
      <WaitingPanel view={view} trial={trial} onOpenBind={onOpenBind} onRefresh={onRefresh}/>
      {view.kind === 'blocked' && <BlockedPanel trial={trial} onRefresh={onRefresh}/>}
      <EndedPanel trial={trial} view={view} onCreate={onCreate}/>
      {view.kind === 'unknown' && <section className="serving-entry-state warning">
        <span className="serving-entry-icon"><ServingIcon name="alert" size={24}/></span>
        <div><span className="serving-kicker">UNRECOGNIZED STATE</span><h3>后端返回了尚未识别的工作流状态</h3><p>页面不会把 {view.rawState} / {view.rawRequestState} 推断为就绪。请刷新并检查 Worker 与 API 版本。</p><button type="button" className="secondary" onClick={onRefresh}>重新读取</button></div>
      </section>}

      {activeConversation && <>
        <div className="serving-conversation" ref={messagesRef} aria-live="off">
          {!messages.length ? <ConversationEmpty onPrompt={onText}/> : messages.map((message, index) => <article
            key={`${index}-${message.role}`}
            className={'serving-message ' + message.role}
          >
            <span className="serving-message-avatar"><ServingIcon name={message.role === 'user' ? 'user' : 'bot'} size={15}/></span>
            <div>
              <header><strong>{message.role === 'user' ? '你' : 'Adapter'}</strong>{message.partial && <span>部分输出 · 不进入下一轮</span>}</header>
              <p>{message.content || (message.role === 'assistant' ? '正在等待模型输出…' : '')}</p>
            </div>
          </article>)}
        </div>
        {view.kind !== 'ended' && <form
          className="serving-composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSend) onSend();
          }}
        >
          <label htmlFor="serving-chat-input" className="serving-sr-only">发送给当前 Adapter 的消息</label>
          <textarea
            id="serving-chat-input"
            rows={3}
            value={text}
            maxLength={runtime?.inference.conversation.max_content_chars_per_message ?? 12000}
            disabled={view.kind !== 'ready' || Boolean(runtimeError) || stale}
            placeholder={composerReason || '输入一条业务问题，Ctrl + Enter 发送'}
            onChange={(event) => onText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canSend) {
                event.preventDefault();
                onSend();
              }
            }}
          />
          <div className="serving-composer-foot">
            <details className="serving-chat-params">
              <summary>生成参数</summary>
              <div>
                <label>最大 Token<input type="number" min={1} max={runtime?.inference.conversation.max_tokens_limit ?? 256} value={maxTokens} disabled={!runtime || sending || view.kind === 'generating'} onChange={(event) => onMaxTokens(Number(event.target.value))}/></label>
                <label>Temperature<input type="number" min={0} max={2} step={0.1} value={temperature} disabled={!runtime || sending || view.kind === 'generating'} onChange={(event) => onTemperature(Number(event.target.value))}/></label>
                <label>Top P<input type="number" min={0.01} max={1} step={0.01} value={topP} disabled={!runtime || sending || view.kind === 'generating'} onChange={(event) => onTopP(Number(event.target.value))}/></label>
              </div>
            </details>
            <span className="serving-compose-note">{text.length} / {runtime?.inference.conversation.max_content_chars_per_message ?? 12000}</span>
            <div className="serving-compose-actions">
              {messages.length > 0 && trial.request_state === 'idle' && !sending && <button type="button" className="serving-quiet-button" onClick={onClear}>清空会话</button>}
              {(view.kind === 'generating' || view.kind === 'cancelling' || sending) && <button
                type="button"
                className="serving-stop-button"
                disabled={cancelling || view.kind === 'cancelling'}
                onClick={onStop}
              ><ServingIcon name="stop" size={14}/>{cancelling || view.kind === 'cancelling' ? '停止确认中' : '停止生成'}</button>}
              <button
                type="submit"
                className="serving-send-button"
                disabled={!canSend || sending || cancelling}
                title={composerReason || '发送消息'}
              >{sending ? '发送中…' : '发送'} <ServingIcon name="send" size={15}/></button>
            </div>
          </div>
          <div className="serving-composer-disabled-reason" aria-live="polite">
            {composerReason || `推理基线 ${runtime?.model.display_name || ''} · 当前请求不会持久化`}
          </div>
        </form>}
      </>}

      {!activeConversation && view.kind === 'request_unknown' && <section className="serving-unknown-request">
        <ServingIcon name="alert" size={20}/><div><strong>上一请求不可重试或继续</strong><p>请等待 Worker 对账，必要时在右侧结束 Trial。实例与租约仍由后端保留。</p></div>
      </section>}
    </div>
  </section>;
}
