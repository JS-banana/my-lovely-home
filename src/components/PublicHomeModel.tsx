'use client'

import dynamic from 'next/dynamic'
import {
  useCallback,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import type { HomeSceneData, ModelView, WalkMotion } from '@/lib/home-model-types'

import Icon from './Icon'
import { Button } from './ui/button'
import sceneStyles from './HomeModel.module.css'
import styles from './PublicHomeModel.module.css'

const HomeModelScene = dynamic(() => import('./HomeModelScene'), { ssr: false })

type SceneStatus = 'loading' | 'ready' | 'error'

const EMPTY_OBJECTS: HomeSceneData['objects'] = []

export default function PublicHomeModel({ model }: { model: HomeSceneData }) {
  const firstRoom = model.rooms[0]?.id ?? ''
  const [selectedRoom, setSelectedRoom] = useState(firstRoom)
  const [view, setView] = useState<ModelView>({ kind: 'overview', serial: 0 })
  const [motion, setMotion] = useState<WalkMotion>(null)
  const [furniture, setFurniture] = useState(true)
  const [roomLabels, setRoomLabels] = useState(true)
  const [blocked, setBlocked] = useState(false)
  const [status, setStatus] = useState<SceneStatus>('loading')
  const [sceneAttempt, setSceneAttempt] = useState(0)

  const room = model.rooms.find((item) => item.id === selectedRoom)
  const walking = view.kind === 'walk'
  const wallCut = Math.min(model.referenceHeight, 1.2)

  const requestView = useCallback((kind: ModelView['kind'], roomId?: string) => {
    setBlocked(false)
    setMotion(null)
    setView((current) => ({
      kind,
      serial: current.serial + 1,
      room: roomId,
    }))
  }, [])

  const chooseRoom = useCallback(
    (roomId: string, focus = false) => {
      setSelectedRoom(roomId)
      if (focus) requestView('focus', roomId)
    },
    [requestView],
  )

  const handleSceneSelect = useCallback(
    (id: string) => {
      if (!id.startsWith('room:')) return
      const roomId = id.slice(5)
      if (model.rooms.some((item) => item.id === roomId)) chooseRoom(roomId, true)
    },
    [chooseRoom, model.rooms],
  )

  const handleRoomChange = useCallback(
    (roomId: string) => {
      if (model.rooms.some((item) => item.id === roomId)) setSelectedRoom(roomId)
    },
    [model.rooms],
  )

  const startMotion = (next: WalkMotion, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!walking) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setBlocked(false)
    setMotion(next)
  }

  const stopMotion = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    setMotion(null)
  }

  const startKeyboardMotion = (next: WalkMotion, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!walking || (event.key !== ' ' && event.key !== 'Enter')) return
    event.preventDefault()
    setBlocked(false)
    setMotion(next)
  }

  const stopKeyboardMotion = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      setMotion(null)
    }
  }

  const retry = () => {
    setStatus('loading')
    setSceneAttempt((attempt) => attempt + 1)
  }

  return (
    <section className={`${sceneStyles.viewer} ${styles.publicRoot}`} aria-label="公开三维户型参观">
      <div className={`${sceneStyles.viewport} ${styles.publicViewport}`}>
        <div
          className={styles.stage}
          aria-label="三维房屋参观区"
          aria-busy={status === 'loading'}
          aria-describedby="public-scene-help"
        >
          <HomeModelScene
            key={sceneAttempt}
            model={model}
            mode="home"
            visibleObjects={EMPTY_OBJECTS}
            primaryObjects={EMPTY_OBJECTS}
            showPowerSupply={false}
            showRoutes={false}
            selected={selectedRoom ? `room:${selectedRoom}` : ''}
            wallCut={wallCut}
            furniture={furniture}
            structure={true}
            roomLabels={roomLabels}
            view={view}
            motion={motion}
            onBlocked={setBlocked}
            onStructureBase={() => {}}
            onSelect={handleSceneSelect}
            onRoomChange={handleRoomChange}
            onStatus={setStatus}
          />
        </div>

        <div className={styles.controls}>
          <div className={styles.controlPanel} aria-label="参观控制">
            <div className={styles.panelHeader}>
              <h2>探索空间</h2>
              <span className={styles.panelState} aria-live="polite">
                {walking
                  ? `正在参观${room?.name ?? '房间'}`
                  : view.kind === 'focus'
                    ? room?.name
                    : '全屋'}
              </span>
            </div>

            <div className={styles.viewModes} role="group" aria-label="查看模式">
              <Button
                variant={view.kind === 'overview' ? 'primary' : 'secondary'}
                aria-pressed={view.kind === 'overview'}
                onClick={() => requestView('overview')}
              >
                <Icon name="home" size={16} />
                总览
              </Button>
              <Button
                variant={view.kind === 'top' ? 'primary' : 'secondary'}
                aria-pressed={view.kind === 'top'}
                onClick={() => requestView('top')}
              >
                <Icon name="layers" size={16} />
                俯视
              </Button>
              {view.kind !== 'overview' && (
                <Button variant="outline" onClick={() => requestView('overview')}>
                  返回总览
                </Button>
              )}
            </div>

            <div className={styles.roomControls}>
              <label className={styles.roomPicker}>
                <span>选择房间</span>
                <select
                  value={selectedRoom}
                  aria-label="选择房间"
                  disabled={!model.rooms.length}
                  onChange={(event) => chooseRoom(event.target.value)}
                >
                  {model.rooms.length ? (
                    model.rooms.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.name}
                      </option>
                    ))
                  ) : (
                    <option value="">暂无房间</option>
                  )}
                </select>
              </label>
              <div className={styles.roomActions}>
                <Button
                  variant={view.kind === 'focus' ? 'primary' : 'secondary'}
                  disabled={!selectedRoom}
                  aria-pressed={view.kind === 'focus'}
                  onClick={() => requestView('focus', selectedRoom)}
                >
                  查看房间
                </Button>
                <Button
                  variant={walking ? 'primary' : 'secondary'}
                  disabled={!selectedRoom}
                  aria-pressed={walking}
                  onClick={() => requestView('walk', selectedRoom)}
                >
                  进入房间漫游
                </Button>
              </div>
            </div>

            <div className={styles.displayOptions} aria-label="显示设置">
              <label className={styles.checkOption}>
                <input
                  type="checkbox"
                  checked={furniture}
                  onChange={(event) => setFurniture(event.target.checked)}
                />
                <span>家具</span>
              </label>
              <label className={styles.checkOption}>
                <input
                  type="checkbox"
                  checked={roomLabels}
                  onChange={(event) => setRoomLabels(event.target.checked)}
                />
                <span>房间标签</span>
              </label>
            </div>
          </div>

          <p className={styles.help} id="public-scene-help">
            {walking
              ? '拖动画面转头，点击地面移动；也可使用 W/A/S/D、方向键或屏幕方向按钮。'
              : '拖动画面旋转，滚轮缩放；选择房间后可进入室内漫游。'}
          </p>
        </div>

        {walking && (
          <div className={styles.walkPad} role="group" aria-label="方向移动">
            <Button
              variant="secondary"
              className={styles.walkButton}
              aria-label="向前移动"
              onPointerDown={(event) => startMotion('forward', event)}
              onPointerUp={stopMotion}
              onPointerCancel={stopMotion}
              onPointerLeave={stopMotion}
              onLostPointerCapture={() => setMotion(null)}
              onKeyDown={(event) => startKeyboardMotion('forward', event)}
              onKeyUp={stopKeyboardMotion}
              onBlur={() => setMotion(null)}
              onContextMenu={(event) => event.preventDefault()}
            >
              <Icon name="arrow-up" size={20} />
            </Button>
            <Button
              variant="secondary"
              className={styles.walkButton}
              aria-label="向左移动"
              onPointerDown={(event) => startMotion('left', event)}
              onPointerUp={stopMotion}
              onPointerCancel={stopMotion}
              onPointerLeave={stopMotion}
              onLostPointerCapture={() => setMotion(null)}
              onKeyDown={(event) => startKeyboardMotion('left', event)}
              onKeyUp={stopKeyboardMotion}
              onBlur={() => setMotion(null)}
              onContextMenu={(event) => event.preventDefault()}
            >
              <Icon name="arrow-left" size={20} />
            </Button>
            <Button
              variant="secondary"
              className={styles.walkButton}
              aria-label="向后移动"
              onPointerDown={(event) => startMotion('back', event)}
              onPointerUp={stopMotion}
              onPointerCancel={stopMotion}
              onPointerLeave={stopMotion}
              onLostPointerCapture={() => setMotion(null)}
              onKeyDown={(event) => startKeyboardMotion('back', event)}
              onKeyUp={stopKeyboardMotion}
              onBlur={() => setMotion(null)}
              onContextMenu={(event) => event.preventDefault()}
            >
              <Icon name="arrow-down" size={20} />
            </Button>
            <Button
              variant="secondary"
              className={styles.walkButton}
              aria-label="向右移动"
              onPointerDown={(event) => startMotion('right', event)}
              onPointerUp={stopMotion}
              onPointerCancel={stopMotion}
              onPointerLeave={stopMotion}
              onLostPointerCapture={() => setMotion(null)}
              onKeyDown={(event) => startKeyboardMotion('right', event)}
              onKeyUp={stopKeyboardMotion}
              onBlur={() => setMotion(null)}
              onContextMenu={(event) => event.preventDefault()}
            >
              <Icon name="arrow-right" size={20} />
            </Button>
          </div>
        )}

        {blocked && walking && (
          <div className={styles.blocked} role="status">
            前方有墙体或家具，已停下
          </div>
        )}

        {status === 'loading' && (
          <div className={styles.loading} role="status">
            正在加载 3D 场景…
          </div>
        )}

        {status === 'error' && (
          <div className={styles.error} role="alert">
            <Icon name="alert" size={24} />
            <div>
              <h2>3D 场景暂时无法加载</h2>
              <p>可以重新尝试加载参观模型。</p>
            </div>
            <Button variant="primary" onClick={retry}>
              重新加载
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}
