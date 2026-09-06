import { BATCH_GROUPS, type Artboard } from '../../data/batchBoards'

/** 红金 KV 画面：红色渐变 + 粒子 + 金色立体标题 */
function KvArt({ compact }: { compact?: boolean }) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-b from-[#f5143c] via-[#e8123a] to-[#c40e32]">
      {[
        [16, 22], [44, 12], [70, 30], [86, 18], [28, 48],
        [60, 58], [78, 70], [10, 64], [50, 80], [92, 52],
      ].map(([x, y], i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            width: 1.4,
            height: 1.4,
            opacity: i % 2 === 0 ? 0.9 : 0.45,
          }}
        />
      ))}
      {/* 金色标题占位 */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[0.5px]"
        style={{
          width: '72%',
          height: compact ? '13%' : '17%',
          background: 'linear-gradient(180deg,#fff3cf,#ffcb52 55%,#d99425)',
        }}
      />
      {/* 底部台座 */}
      <div
        className="absolute bottom-[12%] left-1/2 -translate-x-1/2 rounded-full"
        style={{ width: '54%', height: '5%', background: 'rgba(255,214,120,0.55)' }}
      />
    </div>
  )
}

/** 浅色 App 场景截图：状态栏 + 导航 + KV 横幅 + 内容卡片列 */
function ScreenArt() {
  return (
    <div className="flex h-full w-full flex-col bg-white">
      <div className="flex items-center justify-between px-[3px] pt-[2px]">
        <span className="h-[1.5px] w-[6px] rounded bg-[#c8ccd2]" />
        <span className="h-[1.5px] w-[5px] rounded bg-[#c8ccd2]" />
      </div>
      <div className="flex gap-[2px] px-[3px] pt-[2px]">
        {[10, 7, 7, 6].map((w, i) => (
          <span
            key={i}
            className="h-[1.5px] rounded"
            style={{ width: w, background: i === 0 ? '#ff4d6a' : '#dde0e5' }}
          />
        ))}
      </div>
      {/* KV 横幅 */}
      <div className="mx-[3px] mt-[2px] h-[26%] overflow-hidden rounded-[1.5px]">
        <KvArt compact />
      </div>
      {/* 内容卡片 */}
      <div className="grid flex-1 grid-cols-2 gap-[2px] p-[3px]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-[1.5px] bg-[#eef0f3]">
            <div
              className="h-[62%] w-full"
              style={{
                background: ['#c9a7a0', '#a8b4c4', '#c4b39a', '#9fb0a8', '#bfa8b8', '#aab5c0'][i],
              }}
            />
            <div className="space-y-[1px] p-[1.5px]">
              <span className="block h-[1px] w-full rounded bg-[#d5d8dd]" />
              <span className="block h-[1px] w-[70%] rounded bg-[#e0e2e6]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 深色 App 场景截图 */
function DarkScreenArt() {
  return (
    <div className="flex h-full w-full flex-col bg-[#17181d]">
      <div className="flex gap-[2px] px-[3px] pt-[3px]">
        {[9, 7, 6].map((w, i) => (
          <span
            key={i}
            className="h-[1.5px] rounded"
            style={{ width: w, background: i === 0 ? '#ff4d6a' : '#3a3d45' }}
          />
        ))}
      </div>
      <div className="mx-[3px] mt-[2px] h-[24%] overflow-hidden rounded-[1.5px]">
        <KvArt compact />
      </div>
      <div className="grid flex-1 grid-cols-2 gap-[2px] p-[3px]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-[1.5px]"
            style={{ background: ['#3d4450', '#4a4038', '#37424d', '#453a45'][i] }}
          />
        ))}
      </div>
    </div>
  )
}

/** 直播封面：竖版人物 + 底部信息条 */
function CoverArt() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-b from-[#e8b4c0] to-[#c98a9c]">
      {/* 人物剪影 */}
      <svg viewBox="0 0 40 80" className="absolute inset-0 h-full w-full">
        <circle cx="20" cy="26" r="10" fill="rgba(255,255,255,0.42)" />
        <path d="M4 80c2.6-20 8.4-30 16-30s13.4 10 16 30z" fill="rgba(255,255,255,0.42)" />
      </svg>
      <div
        className="absolute bottom-[6%] left-1/2 -translate-x-1/2 rounded-[0.5px]"
        style={{
          width: '70%',
          height: '9%',
          background: 'linear-gradient(180deg,#fff3cf,#ffcb52)',
        }}
      />
    </div>
  )
}

/** 横版长条 banner */
function StripArt() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-r from-[#f5143c] to-[#ff7a4d]">
      <div
        className="absolute left-[6%] top-1/2 -translate-y-1/2 rounded-[0.5px]"
        style={{ width: '46%', height: '38%', background: 'linear-gradient(180deg,#fff3cf,#ffcb52)' }}
      />
    </div>
  )
}

function BoardArt({ kind }: { kind: Artboard['kind'] }) {
  if (kind === 'kv') return <KvArt />
  if (kind === 'screen') return <ScreenArt />
  if (kind === 'dark-screen') return <DarkScreenArt />
  if (kind === 'cover') return <CoverArt />
  if (kind === 'banner' || kind === 'strip') return <StripArt />
  return <KvArt />
}

/**
 * 批量产出画布。
 * 依据回放截图：生成结果以「画板组」形式在深色画布上平铺，
 * 每组为同一渠道的场景与物料配对，画板上方带名称标签，便于逐一验收。
 */
export default function BatchCanvas() {
  return (
    <div className="scroll-clean h-full w-full overflow-auto bg-[#2c2c2e] p-[26px]">
      <div className="flex items-start gap-[18px]">
        {BATCH_GROUPS.map((group) => (
          <div key={group.id} className="flex shrink-0 flex-col gap-[10px]">
            {/* 组内画板按纵向排布，宽度不一时左对齐 */}
            <div className="flex items-start gap-[8px]">
              {group.boards.slice(0, 2).map((board, i) => (
                <div key={i} className="shrink-0">
                  {board.label && (
                    <div className="mb-[3px] truncate text-[8px] font-medium text-white/80">
                      {board.label}
                    </div>
                  )}
                  <div
                    className="overflow-hidden rounded-[2px] ring-1 ring-white/10"
                    style={{ width: board.w, height: board.h }}
                  >
                    <BoardArt kind={board.kind} />
                  </div>
                </div>
              ))}
            </div>

            {/* 超过两块的画板换行显示 */}
            {group.boards.length > 2 && (
              <div className="flex items-start gap-[8px]">
                {group.boards.slice(2).map((board, i) => (
                  <div key={i} className="shrink-0">
                    {board.label && (
                      <div className="mb-[3px] truncate text-[8px] font-medium text-white/80">
                        {board.label}
                      </div>
                    )}
                    <div
                      className="overflow-hidden rounded-[2px] ring-1 ring-white/10"
                      style={{ width: board.w, height: board.h }}
                    >
                      <BoardArt kind={board.kind} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
