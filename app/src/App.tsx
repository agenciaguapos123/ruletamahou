import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react'
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom'
import './App.css'
import {
  ActivationPrize,
  ActivationSpinLog,
  ActivationSession,
  AppState,
  AppUser,
  Campaign,
  CampaignStatus,
  CampaignType,
  Island,
  Location,
  PrizeCategory,
  PrizeTemplate,
  PrizeTimeMode,
  ScheduleWindow,
  buildActivationSession,
  buildPrizeTemplateFromCategory,
  createId,
  createScheduleWindow,
  drawPrize,
  formatLocationList,
  getLivePrizes,
  isWindowActive,
  loadAppState,
  loadSessionUser,
  parsePromoters,
  saveAppState,
  saveSessionUser,
} from './appModel'

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`

function formatLogTimestamp(value: string): string {
  return new Date(value).toLocaleString('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function getCampaignStatusLabel(status: CampaignStatus): string {
  if (status === 'active') {
    return 'Activa'
  }

  if (status === 'closed') {
    return 'Cerrada'
  }

  return 'Pausada'
}

function summarizeSpinLogs(spinLogs: ActivationSpinLog[]) {
  const prizeMap = new Map<string, { name: string; count: number }>()

  for (const spinLog of spinLogs) {
    const entryKey = spinLog.prizeTemplateId || spinLog.prizeName
    const existingEntry = prizeMap.get(entryKey)

    if (existingEntry) {
      existingEntry.count += 1
      continue
    }

    prizeMap.set(entryKey, { name: spinLog.prizeName, count: 1 })
  }

  return Array.from(prizeMap.values()).sort(
    (left, right) => right.count - left.count || left.name.localeCompare(right.name, 'es'),
  )
}

function getSessionSpinLogs(session: ActivationSession): ActivationSpinLog[] {
  return Array.isArray(session.spinLogs) ? session.spinLogs : []
}

function getIslandName(islandId: string | null, islands: Island[]): string {
  if (!islandId) {
    return 'Sin isla asignada'
  }

  return islands.find((island) => island.id === islandId)?.name ?? 'Sin isla asignada'
}

function createDraftWindowSet(quota = 10): ScheduleWindow[] {
  return [createScheduleWindow('Franja 1', '18:00', '21:00', quota)]
}

function cloneDraftWindows(windows: ScheduleWindow[]): ScheduleWindow[] {
  return windows.map((windowSlot) => ({ ...windowSlot }))
}

function clonePrizeTemplateForEditor(prizeTemplate: PrizeTemplate): PrizeTemplate {
  return {
    ...prizeTemplate,
    windows: cloneDraftWindows(prizeTemplate.windows),
  }
}

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  mozFullScreenElement?: Element | null
  msFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
  mozCancelFullScreen?: () => Promise<void> | void
  msExitFullscreen?: () => Promise<void> | void
}

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
  mozRequestFullScreen?: () => Promise<void> | void
  msRequestFullscreen?: () => Promise<void> | void
}

function getFullscreenElement(): Element | null {
  if (typeof document === 'undefined') {
    return null
  }

  const fullscreenDocument = document as FullscreenDocument

  return (
    fullscreenDocument.fullscreenElement ??
    fullscreenDocument.webkitFullscreenElement ??
    fullscreenDocument.mozFullScreenElement ??
    fullscreenDocument.msFullscreenElement ??
    null
  )
}

function FullscreenIcon() {
  return (
    <svg
      aria-hidden="true"
      className="fullscreen-icon"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4 9V4H9M15 4H20V9M20 15V20H15M9 20H4V15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg
      aria-hidden="true"
      className="refresh-icon"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M20 11A8 8 0 1 0 17.66 17M20 11V5M20 11H14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function RefreshButton() {
  const handleRefresh = async () => {
    if (typeof window === 'undefined') {
      return
    }

    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map((registration) => registration.unregister()))
      }

      if ('caches' in window) {
        const cacheNames = await caches.keys()
        await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)))
      }
    } catch {
      // Best effort only. Browsers do not expose a real Ctrl+F5 API.
    }

    const url = new URL(window.location.href)
    url.searchParams.set('_refresh', Date.now().toString())
    window.location.replace(url.toString())
  }

  return (
    <button
      className="refresh-toggle"
      type="button"
      onClick={() => {
        void handleRefresh()
      }}
      aria-label="Actualizar pagina"
      title="Actualizar pagina"
    >
      <RefreshIcon />
      <span>Actualizar</span>
    </button>
  )
}

function FullscreenToggle() {
  const [isFullscreen, setIsFullscreen] = useState(() =>
    Boolean(getFullscreenElement()),
  )

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(getFullscreenElement()))
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    document.addEventListener('mozfullscreenchange', handleFullscreenChange)
    document.addEventListener('MSFullscreenChange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange)
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange)
    }
  }, [])

  const handleToggleFullscreen = () => {
    if (typeof document === 'undefined') {
      return
    }

    const fullscreenDocument = document as FullscreenDocument
    const fullscreenRoot = document.documentElement as FullscreenElement
    const fullscreenBody = document.body as FullscreenElement | null
    const currentFullscreenElement = getFullscreenElement()

    const handleFullscreenError = () => {
      setIsFullscreen(Boolean(getFullscreenElement()))
    }

    try {
      if (currentFullscreenElement) {
        if (fullscreenDocument.exitFullscreen) {
          const result = fullscreenDocument.exitFullscreen()
          Promise.resolve(result).catch(handleFullscreenError)
          return
        }

        if (fullscreenDocument.webkitExitFullscreen) {
          const result = fullscreenDocument.webkitExitFullscreen()
          Promise.resolve(result).catch(handleFullscreenError)
          return
        }

        if (fullscreenDocument.mozCancelFullScreen) {
          const result = fullscreenDocument.mozCancelFullScreen()
          Promise.resolve(result).catch(handleFullscreenError)
          return
        }

        if (fullscreenDocument.msExitFullscreen) {
          const result = fullscreenDocument.msExitFullscreen()
          Promise.resolve(result).catch(handleFullscreenError)
        }

        return
      }

      if (fullscreenRoot.requestFullscreen) {
        const result = fullscreenRoot.requestFullscreen()
        Promise.resolve(result).catch(handleFullscreenError)
        return
      }

      if (fullscreenRoot.webkitRequestFullscreen) {
        const result = fullscreenRoot.webkitRequestFullscreen()
        Promise.resolve(result).catch(handleFullscreenError)
        return
      }

      if (fullscreenRoot.mozRequestFullScreen) {
        const result = fullscreenRoot.mozRequestFullScreen()
        Promise.resolve(result).catch(handleFullscreenError)
        return
      }

      if (fullscreenRoot.msRequestFullscreen) {
        const result = fullscreenRoot.msRequestFullscreen()
        Promise.resolve(result).catch(handleFullscreenError)
        return
      }

      if (fullscreenBody?.requestFullscreen) {
        const result = fullscreenBody.requestFullscreen()
        Promise.resolve(result).catch(handleFullscreenError)
        return
      }

      if (fullscreenBody?.webkitRequestFullscreen) {
        const result = fullscreenBody.webkitRequestFullscreen()
        Promise.resolve(result).catch(handleFullscreenError)
        return
      }

      if (fullscreenBody?.mozRequestFullScreen) {
        const result = fullscreenBody.mozRequestFullScreen()
        Promise.resolve(result).catch(handleFullscreenError)
        return
      }

      if (fullscreenBody?.msRequestFullscreen) {
        const result = fullscreenBody.msRequestFullscreen()
        Promise.resolve(result).catch(handleFullscreenError)
      }
    } catch {
      handleFullscreenError()
    }
  }

  return (
    <button
      className="fullscreen-toggle"
      type="button"
      onClick={handleToggleFullscreen}
      aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
      aria-pressed={isFullscreen}
      title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
    >
      <FullscreenIcon />
    </button>
  )
}

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [appState, setAppState] = useState<AppState>(() => loadAppState())
  const [currentUser, setCurrentUser] = useState<AppUser | null>(() =>
    loadSessionUser(loadAppState()),
  )
  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [campaignBuilderOpen, setCampaignBuilderOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    saveAppState(appState)
  }, [appState])

  useEffect(() => {
    saveSessionUser(currentUser)
  }, [currentUser])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(new Date())
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    if (!currentUser) {
      return
    }

    const refreshedUser = appState.users.find((user) => user.id === currentUser.id) ?? null

    if (!refreshedUser) {
      setCurrentUser(null)
      return
    }

    if (
      refreshedUser.username !== currentUser.username ||
      refreshedUser.password !== currentUser.password ||
      refreshedUser.displayName !== currentUser.displayName ||
      refreshedUser.role !== currentUser.role
    ) {
      setCurrentUser(refreshedUser)
    }
  }, [appState.users, currentUser])

  useEffect(() => {
    if (location.pathname !== '/admin') {
      setCampaignBuilderOpen(false)
    }
  }, [location.pathname])

  const canAccessAdmin = currentUser?.role === 'admin' || adminUnlocked

  const handleLogin = (username: string, password: string) => {
    const normalizedUsername = username.trim().toLowerCase()
    const user = appState.users.find(
      (entry) =>
        entry.username.toLowerCase() === normalizedUsername && entry.password === password,
    )

    if (!user) {
      return 'Usuario o contrasena incorrectos.'
    }

    setCurrentUser(user)
    setAdminUnlocked(user.role === 'admin')
    navigate('/')
    return null
  }

  const handleLogout = () => {
    setCurrentUser(null)
    setAdminUnlocked(false)
    navigate('/')
  }

  const updateSession = (
    sessionId: string,
    updater: (session: ActivationSession) => ActivationSession,
  ) => {
    setAppState((previousState) => ({
      ...previousState,
      sessions: previousState.sessions.map((session) =>
        session.id === sessionId ? updater(session) : session,
      ),
    }))
  }

  const updateSessionPrize = (
    sessionId: string,
    templateId: string,
    updater: (prize: ActivationPrize) => ActivationPrize,
  ) => {
    updateSession(sessionId, (session) => ({
      ...session,
      prizes: session.prizes.map((prize) =>
        prize.templateId === templateId ? updater(prize) : prize,
      ),
    }))
  }

  const handleStartActivation = (campaignId: string, rawPromoters: string, islandId: string) => {
    const campaign = appState.campaigns.find((entry) => entry.id === campaignId)
    const island = appState.islands.find((entry) => entry.id === islandId)

    if (!campaign || campaign.status !== 'active') {
      return 'Selecciona una accion o ruta activa.'
    }

    if (!island) {
      return 'Selecciona una isla para abrir la activacion.'
    }

    if (campaign.islandId && campaign.islandId !== island.id) {
      return 'La accion o ruta seleccionada no pertenece a la isla indicada.'
    }

    const promoterNames = parsePromoters(rawPromoters)

    if (!promoterNames.length) {
      return 'Introduce al menos un promotor para abrir la activacion.'
    }

    const session = buildActivationSession(campaign, promoterNames, island)

    setAppState((previousState) => ({
      ...previousState,
      sessions: [session, ...previousState.sessions],
    }))

    navigate(`/activation/${session.id}`)
    return null
  }

  const handleConsumePrize = (sessionId: string, prize: ActivationPrize) => {
    const consumedAt = new Date().toISOString()

    updateSession(sessionId, (session) => ({
      ...session,
      lastPrizeId: prize.templateId,
      lastPrizeName: prize.name,
      lastSpinAt: consumedAt,
      spinLogs: [
        {
          id: createId('spin'),
          prizeTemplateId: prize.templateId,
          prizeName: prize.name,
          prizeImageSrc: prize.imageSrc ?? null,
          awardedAt: consumedAt,
        },
        ...getSessionSpinLogs(session),
      ],
      prizes: session.prizes.map((sessionPrize) =>
        sessionPrize.templateId === prize.templateId
          ? {
              ...sessionPrize,
              remainingStock: Math.max(sessionPrize.remainingStock - 1, 0),
            }
          : sessionPrize,
      ),
    }))
  }

  const handleFinishSession = (sessionId: string) => {
    updateSession(sessionId, (session) => ({
      ...session,
      status: 'completed',
    }))
    navigate('/')
  }

  const handleUnlockAdmin = (code: string) => {
    if (currentUser?.role === 'admin' || code.trim() === appState.adminAccessCode) {
      setAdminUnlocked(true)
      return true
    }

    return false
  }

  const handleCreateLocation = (name: string, city: string) => {
    setAppState((previousState) => ({
      ...previousState,
      locations: [
        ...previousState.locations,
        {
          id: createId('location'),
          name,
          city,
        },
      ],
    }))
  }

  const handleUpdateLocation = (locationId: string, name: string, city: string) => {
    setAppState((previousState) => ({
      ...previousState,
      locations: previousState.locations.map((location) =>
        location.id === locationId ? { ...location, name, city } : location,
      ),
    }))
  }

  const handleDeleteLocation = (locationId: string) => {
    setAppState((previousState) => {
      const nextCampaigns = previousState.campaigns.map((campaign) => {
        const nextLocationIds = campaign.locationIds.filter((entry) => entry !== locationId)

        if (nextLocationIds.length === campaign.locationIds.length) {
          return campaign
        }

        return {
          ...campaign,
          locationIds: nextLocationIds,
          status: nextLocationIds.length ? campaign.status : 'closed',
        }
      })

      return {
        ...previousState,
        locations: previousState.locations.filter((location) => location.id !== locationId),
        campaigns: nextCampaigns,
        sessions: previousState.sessions.map((session) => {
          const nextLocationIds = session.locationIds.filter((entry) => entry !== locationId)

          if (nextLocationIds.length === session.locationIds.length) {
            return session
          }

          const matchingCampaign = nextCampaigns.find((campaign) => campaign.id === session.campaignId)

          return {
            ...session,
            locationIds: nextLocationIds,
            status:
              session.status === 'live' && (!matchingCampaign || !matchingCampaign.locationIds.length)
                ? 'completed'
                : session.status,
          }
        }),
      }
    })
  }

  const handleCreateIsland = (name: string) => {
    setAppState((previousState) => ({
      ...previousState,
      islands: [
        ...previousState.islands,
        {
          id: createId('island'),
          name,
        },
      ],
    }))
  }

  const handleUpdateIsland = (islandId: string, name: string) => {
    setAppState((previousState) => ({
      ...previousState,
      islands: previousState.islands.map((island) =>
        island.id === islandId ? { ...island, name } : island,
      ),
      sessions: previousState.sessions.map((session) =>
        session.islandId === islandId ? { ...session, islandName: name } : session,
      ),
    }))
  }

  const handleDeleteIsland = (islandId: string) => {
    setAppState((previousState) => ({
      ...previousState,
      islands: previousState.islands.filter((island) => island.id !== islandId),
      campaigns: previousState.campaigns.map((campaign) =>
        campaign.islandId === islandId ? { ...campaign, islandId: null } : campaign,
      ),
    }))
  }

  const handleCreatePrizeCategory = (prizeCategory: PrizeCategory) => {
    setAppState((previousState) => ({
      ...previousState,
      prizeCategories: [...previousState.prizeCategories, prizeCategory],
    }))
  }

  const handleUpdatePrizeCategory = (updatedPrizeCategory: PrizeCategory) => {
    setAppState((previousState) => ({
      ...previousState,
      prizeCategories: previousState.prizeCategories.map((prizeCategory) =>
        prizeCategory.id === updatedPrizeCategory.id ? updatedPrizeCategory : prizeCategory,
      ),
      campaigns: previousState.campaigns.map((campaign) => ({
        ...campaign,
        prizeTemplates: campaign.prizeTemplates.map((prizeTemplate) =>
          prizeTemplate.categoryId === updatedPrizeCategory.id
            ? {
                ...prizeTemplate,
                name: updatedPrizeCategory.name,
                description: updatedPrizeCategory.description,
                imageSrc: updatedPrizeCategory.imageSrc,
              }
            : prizeTemplate,
        ),
      })),
    }))
  }

  const handleDeletePrizeCategory = (prizeCategoryId: string) => {
    setAppState((previousState) => ({
      ...previousState,
      prizeCategories: previousState.prizeCategories.filter(
        (prizeCategory) => prizeCategory.id !== prizeCategoryId,
      ),
      campaigns: previousState.campaigns.map((campaign) => ({
        ...campaign,
        prizeTemplates: campaign.prizeTemplates.map((prizeTemplate) =>
          prizeTemplate.categoryId === prizeCategoryId
            ? { ...prizeTemplate, categoryId: null }
            : prizeTemplate,
        ),
      })),
    }))
  }

  const handleCreateCampaign = (campaign: Campaign) => {
    setAppState((previousState) => ({
      ...previousState,
      campaigns: [campaign, ...previousState.campaigns],
    }))
  }

  const handleUpdateCampaign = (updatedCampaign: Campaign) => {
    setAppState((previousState) => ({
      ...previousState,
      campaigns: previousState.campaigns.map((campaign) =>
        campaign.id === updatedCampaign.id ? updatedCampaign : campaign,
      ),
    }))
  }

  const handleUpdateCampaignStatus = (campaignId: string, nextStatus: CampaignStatus) => {
    setAppState((previousState) => ({
      ...previousState,
      campaigns: previousState.campaigns.map((campaign) =>
        campaign.id === campaignId ? { ...campaign, status: nextStatus } : campaign,
      ),
    }))
  }
  
  const handleDeleteCampaign = (campaignId: string) => {
    setAppState((previousState) => ({
      ...previousState,
      campaigns: previousState.campaigns.filter((campaign) => campaign.id !== campaignId),
      sessions: previousState.sessions.map((session) =>
        session.campaignId === campaignId && session.status === 'live'
          ? { ...session, status: 'completed' }
          : session,
      ),
    }))
  }

  const handleUpdateAdminAccessCode = (currentCode: string, nextCode: string) => {
    if (currentCode.trim() !== appState.adminAccessCode) {
      return 'La clave actual no coincide con la configurada.'
    }

    if (nextCode.trim().length < 6) {
      return 'La nueva clave admin debe tener al menos 6 caracteres.'
    }

    setAppState((previousState) => ({
      ...previousState,
      adminAccessCode: nextCode.trim(),
    }))
    setAdminUnlocked(true)
    return null
  }

  const handleOpenCampaignBuilder = () => {
    setCampaignBuilderOpen(true)
    navigate('/admin')
  }

  const handleCloseCampaignBuilder = () => {
    setCampaignBuilderOpen(false)
  }

  if (!currentUser) {
    return (
      <>
        <LoginScreen onLogin={handleLogin} />
        <RefreshButton />
      </>
    )
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar topbar-app">
        <img className="topbar-corner-logo" src={assetPath('brands/mahou-logo-white.png')} alt="Mahou" />
        <h1 className="hero-title app-shell-title">RULETA DE PREMIOS</h1>

        <nav className="topbar-nav topbar-nav-app">
          <button
            className={location.pathname === '/' ? 'menu-link menu-link-active' : 'menu-link'}
            type="button"
            onClick={() => navigate('/')}
          >
            Inicio
          </button>
          {canAccessAdmin ? (
            <button
              className={
                location.pathname === '/admin' && campaignBuilderOpen
                  ? 'menu-link menu-link-active'
                  : 'menu-link'
              }
              type="button"
              onClick={handleOpenCampaignBuilder}
            >
              Crear accion/ruta
            </button>
          ) : null}
          <button
            className="menu-link"
            type="button"
            onClick={handleLogout}
          >
            Salir
          </button>
          <button
            className={location.pathname === '/admin' ? 'menu-link menu-link-active menu-link-settings' : 'menu-link menu-link-settings'}
            type="button"
            aria-label="Configuracion"
            title="Configuracion"
            onClick={() => {
              handleCloseCampaignBuilder()
              navigate('/admin')
            }}
          >
            <img className="settings-icon" src={assetPath('icons/settings.png')} alt="" />
          </button>
        </nav>
      </header>

      <Routes>
        <Route
          path="/"
          element={
            <Dashboard
              islands={appState.islands}
              locations={appState.locations}
              campaigns={appState.campaigns}
              sessions={appState.sessions}
              onStartActivation={handleStartActivation}
            />
          }
        />
        <Route
          path="/activation/:sessionId"
          element={
            <ActivationRoute
              locations={appState.locations}
              sessions={appState.sessions}
              now={now}
              canManageSession={canAccessAdmin}
              onUpdatePrize={updateSessionPrize}
              onConsumePrize={handleConsumePrize}
              onFinishSession={handleFinishSession}
            />
          }
        />
        <Route
          path="/admin"
          element={
            canAccessAdmin ? (
              <AdminPanel
                currentUser={currentUser}
                islands={appState.islands}
                locations={appState.locations}
                prizeCategories={appState.prizeCategories}
                campaigns={appState.campaigns}
                sessions={appState.sessions}
                isCampaignBuilderOpen={campaignBuilderOpen}
                onCloseCampaignBuilder={handleCloseCampaignBuilder}
                onCreateIsland={handleCreateIsland}
                onUpdateIsland={handleUpdateIsland}
                onDeleteIsland={handleDeleteIsland}
                onCreateLocation={handleCreateLocation}
                onUpdateLocation={handleUpdateLocation}
                onDeleteLocation={handleDeleteLocation}
                onCreatePrizeCategory={handleCreatePrizeCategory}
                onUpdatePrizeCategory={handleUpdatePrizeCategory}
                onDeletePrizeCategory={handleDeletePrizeCategory}
                onCreateCampaign={handleCreateCampaign}
                onUpdateCampaign={handleUpdateCampaign}
                onUpdateCampaignStatus={handleUpdateCampaignStatus}
                                onDeleteCampaign={handleDeleteCampaign}
                onUpdateAdminAccessCode={handleUpdateAdminAccessCode}
              />
            ) : (
              <AdminGate onUnlock={handleUnlockAdmin} />
            )
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <RefreshButton />
      <FullscreenToggle />
    </div>
  )
}

export default App

function LoginScreen({ onLogin }: { onLogin: (username: string, password: string) => string | null }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = onLogin(username, password)

    if (result) {
      setErrorMessage(result)
      return
    }

    setErrorMessage(null)
  }

  return (
    <div className="auth-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <div className="auth-login-stack">
        <section className="auth-panel auth-login-panel">
          <div className="auth-brand-lockup">
            <img className="auth-logo" src={assetPath('brands/mahou-logo-white.png')} alt="Mahou" />
            <h1 className="hero-title auth-title">RULETA DE PREMIOS</h1>
          </div>

          <form className="stack-form" onSubmit={handleSubmit}>
            <label className="field-group">
              <span>Usuario</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Introduce tu usuario"
              />
            </label>

            <label className="field-group">
              <span>Contraseña</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Introduce tu clave"
              />
            </label>

            {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

            <button className="primary-button" type="submit">
              Acceder
            </button>
          </form>
        </section>

        <p className="auth-footer">
          Copyright 2026©
          <a
            className="auth-footer-link"
            href="https://bydiscordia.com/"
            target="_blank"
            rel="noreferrer"
          >
            Discordia
          </a>
          . All rights reserved.
        </p>
      </div>

      <FullscreenToggle />
    </div>
  )
}

function Dashboard({
  islands,
  locations,
  campaigns,
  sessions,
  onStartActivation,
}: {
  islands: Island[]
  locations: Location[]
  campaigns: Campaign[]
  sessions: ActivationSession[]
  onStartActivation: (campaignId: string, rawPromoters: string, islandId: string) => string | null
}) {
  const navigate = useNavigate()
  const [selectedCampaignId, setSelectedCampaignId] = useState('')
  const [selectedIslandId, setSelectedIslandId] = useState('')
  const [promoterInput, setPromoterInput] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const activeCampaigns = campaigns.filter((campaign) => campaign.status === 'active')
  const filteredActiveCampaigns = activeCampaigns.filter(
    (campaign) => !selectedIslandId || !campaign.islandId || campaign.islandId === selectedIslandId,
  )
  const liveSessions = sessions.filter((session) => session.status === 'live')

  useEffect(() => {
    if (
      !filteredActiveCampaigns.length ||
      !filteredActiveCampaigns.some((campaign) => campaign.id === selectedCampaignId)
    ) {
      setSelectedCampaignId('')
    }
  }, [filteredActiveCampaigns, selectedCampaignId])

  useEffect(() => {
    if (!islands.length || !islands.some((island) => island.id === selectedIslandId)) {
      setSelectedIslandId('')
    }
  }, [islands, selectedIslandId])

  const selectedCampaign =
    filteredActiveCampaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!selectedCampaignId) {
      setErrorMessage(
        selectedIslandId && !filteredActiveCampaigns.length
          ? 'No hay acciones o rutas activas para la isla seleccionada.'
          : 'Necesitas al menos una accion o ruta activa en configuracion.',
      )
      return
    }

    if (!selectedIslandId) {
      setErrorMessage('Selecciona una isla antes de abrir la activacion.')
      return
    }

    const result = onStartActivation(selectedCampaignId, promoterInput, selectedIslandId)

    if (result) {
      setErrorMessage(result)
      return
    }

    setErrorMessage(null)
    setPromoterInput('')
  }

  return (
    <main className="screen-grid dashboard-menu-grid">
      <section className="panel panel-wide dashboard-menu-panel">
        <p className="eyebrow">Menu de activacion</p>
        <h2 className="section-title">Escoge tu accion y entra en la ruleta.</h2>

        <form className="stack-form dashboard-access-form" onSubmit={handleSubmit}>
          <label className="field-group">
            <span>Escoger Isla</span>
            <select
              value={selectedIslandId}
              onChange={(event) => setSelectedIslandId(event.target.value)}
            >
              <option value="">Selecciona una isla</option>
              {islands.map((island) => (
                <option key={island.id} value={island.id}>
                  {island.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field-group">
            <span>Escoger Acción</span>
            <select
              value={selectedCampaignId}
              onChange={(event) => setSelectedCampaignId(event.target.value)}
            >
              <option value="">
                {selectedIslandId
                  ? filteredActiveCampaigns.length
                    ? 'Selecciona una accion o ruta'
                    : 'No hay acciones para esta isla'
                  : activeCampaigns.length
                    ? 'Selecciona una accion o ruta'
                    : 'No hay acciones activas'}
              </option>
              {filteredActiveCampaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name} · {campaign.type === 'accion' ? 'Accion' : 'Ruta'}
                </option>
              ))}
            </select>
          </label>

          {selectedCampaign ? (
            <div className="action-card">
              <div className="action-card-top">
                <span className="campaign-pill">
                  {selectedCampaign.type === 'accion' ? 'Accion' : 'Ruta'}
                </span>
              </div>
              <strong>{selectedCampaign.name}</strong>
              <p>{getIslandName(selectedCampaign.islandId, islands)}</p>
              <p>{formatLocationList(selectedCampaign.locationIds, locations)}</p>
              <div className="tag-row">
                {selectedCampaign.prizeTemplates.map((prizeTemplate) => (
                  <span className="tag" key={prizeTemplate.id}>
                    {prizeTemplate.name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <label className="field-group">
            <span>Promotores</span>
            <input
              value={promoterInput}
              onChange={(event) => setPromoterInput(event.target.value)}
              placeholder="Introduce los nombres separados por coma"
            />
          </label>

          {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

          <button className="primary-button roulette-access-button" type="submit">
            Acceder a Ruleta
          </button>
        </form>
      </section>

      {liveSessions.length ? (
        <section className="panel panel-wide dashboard-session-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Accesos rapidos</p>
              <h2 className="section-title">Activaciones abiertas</h2>
            </div>
          </div>

          <div className="session-button-grid">
            {liveSessions.map((session) => (
              <button
                className="session-menu-button"
                key={session.id}
                type="button"
                onClick={() => navigate(`/activation/${session.id}`)}
              >
                <span className="campaign-pill">
                  {session.campaignType === 'accion' ? 'Accion' : 'Ruta'}
                </span>
                <strong>{session.campaignName}</strong>
                <span>
                  {[formatLocationList(session.locationIds, locations), session.islandName]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  )
}

function AdminGate({ onUnlock }: { onUnlock: (code: string) => boolean }) {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!onUnlock(code)) {
      setErrorMessage('La contrasena admin no es valida.')
      return
    }

    setErrorMessage(null)
    navigate('/admin')
  }

  return (
    <main className="screen-grid">
      <section className="panel panel-center">
        <p className="eyebrow">Zona protegida</p>
        <h2 className="section-title">Desbloquea la configuracion general.</h2>
        <p className="panel-copy">
          Desde aqui se crean acciones, rutas, locales y bolsas de premios para cada
          configuracion base.
        </p>

        <form className="stack-form narrow-form" onSubmit={handleSubmit}>
          <label className="field-group">
            <span>Clave admin</span>
            <input
              type="password"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Introduce la clave admin"
            />
          </label>

          {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

          <button className="primary-button" type="submit">
            Entrar en configuracion
          </button>
        </form>
      </section>
    </main>
  )
}

function AdminPanel({
  currentUser,
  islands,
  locations,
  prizeCategories,
  campaigns,
  sessions,
  isCampaignBuilderOpen,
  onCloseCampaignBuilder,
  onCreateIsland,
  onUpdateIsland,
  onDeleteIsland,
  onCreateLocation,
  onUpdateLocation,
  onDeleteLocation,
  onCreatePrizeCategory,
  onUpdatePrizeCategory,
  onDeletePrizeCategory,
  onCreateCampaign,
  onUpdateCampaign,
  onUpdateCampaignStatus,
  onDeleteCampaign,
  onUpdateAdminAccessCode,
}: {
  currentUser: AppUser
  islands: Island[]
  locations: Location[]
  prizeCategories: PrizeCategory[]
  campaigns: Campaign[]
  sessions: ActivationSession[]
  isCampaignBuilderOpen: boolean
  onCloseCampaignBuilder: () => void
  onCreateIsland: (name: string) => void
  onUpdateIsland: (islandId: string, name: string) => void
  onDeleteIsland: (islandId: string) => void
  onCreateLocation: (name: string, city: string) => void
  onUpdateLocation: (locationId: string, name: string, city: string) => void
  onDeleteLocation: (locationId: string) => void
  onCreatePrizeCategory: (prizeCategory: PrizeCategory) => void
  onUpdatePrizeCategory: (prizeCategory: PrizeCategory) => void
  onDeletePrizeCategory: (prizeCategoryId: string) => void
  onCreateCampaign: (campaign: Campaign) => void
  onUpdateCampaign: (campaign: Campaign) => void
  onUpdateCampaignStatus: (campaignId: string, nextStatus: CampaignStatus) => void
  onUpdateAdminAccessCode: (currentCode: string, nextCode: string) => string | null
  onDeleteCampaign: (campaignId: string) => void
}) {
  const [locationName, setLocationName] = useState('')
  const [locationCity, setLocationCity] = useState('')
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null)
  const [islandName, setIslandName] = useState('')
  const [editingIslandId, setEditingIslandId] = useState<string | null>(null)
  const [categoryName, setCategoryName] = useState('')
  const [categoryDescription, setCategoryDescription] = useState('')
  const [categoryImageSrc, setCategoryImageSrc] = useState<string | null>(null)
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [campaignName, setCampaignName] = useState('')
  const [campaignType, setCampaignType] = useState<CampaignType>('accion')
  const [campaignNotes, setCampaignNotes] = useState('')
  const [campaignIslandId, setCampaignIslandId] = useState('')
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([])
  const [locationFilter, setLocationFilter] = useState('')
  const [selectedPrizeCategoryId, setSelectedPrizeCategoryId] = useState('')
  const [draftPrizes, setDraftPrizes] = useState<PrizeTemplate[]>([])
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null)
  const [editingDraftPrizeId, setEditingDraftPrizeId] = useState<string | null>(null)
  const [prizeStock, setPrizeStock] = useState('10')
  const [prizeTimeMode, setPrizeTimeMode] = useState<PrizeTimeMode>('always')
  const [draftWindows, setDraftWindows] = useState<ScheduleWindow[]>(createDraftWindowSet())
  const [campaignMessage, setCampaignMessage] = useState<string | null>(null)
  const [locationMessage, setLocationMessage] = useState<string | null>(null)
  const [islandMessage, setIslandMessage] = useState<string | null>(null)
  const [categoryMessage, setCategoryMessage] = useState<string | null>(null)
  const [accessCodeCurrent, setAccessCodeCurrent] = useState('')
  const [accessCodeNext, setAccessCodeNext] = useState('')
  const [accessCodeMessage, setAccessCodeMessage] = useState<string | null>(null)
  const manageableCampaigns = campaigns
  const loggedSessions = [...sessions]
    .filter((session) => session.status === 'completed' || getSessionSpinLogs(session).length > 0)
    .sort(
      (left, right) =>
        Date.parse(getSessionSpinLogs(right)[0]?.awardedAt ?? right.startedAt) -
        Date.parse(getSessionSpinLogs(left)[0]?.awardedAt ?? left.startedAt),
    )
  const selectedPrizeCategory =
    prizeCategories.find((prizeCategory) => prizeCategory.id === selectedPrizeCategoryId) ?? null
  const normalizedLocationFilter = locationFilter.trim().toLowerCase()
  const filteredLocations = locations.filter((location) =>
    !normalizedLocationFilter
      ? true
      : [location.name, location.city].some((value) =>
          value.toLowerCase().includes(normalizedLocationFilter),
        ),
  )

  const resetLocationForm = () => {
    setLocationName('')
    setLocationCity('')
    setEditingLocationId(null)
    setLocationMessage(null)
  }

  const resetIslandForm = () => {
    setIslandName('')
    setEditingIslandId(null)
    setIslandMessage(null)
  }

  const resetCategoryForm = () => {
    setCategoryName('')
    setCategoryDescription('')
    setCategoryImageSrc(null)
    setEditingCategoryId(null)
    setCategoryMessage(null)
  }

  const resetDraftPrizeForm = () => {
    setSelectedPrizeCategoryId('')
    setPrizeStock('10')
    setPrizeTimeMode('always')
    setDraftWindows(createDraftWindowSet())
    setEditingDraftPrizeId(null)
  }

  const resetCampaignForm = () => {
    setCampaignName('')
    setCampaignType('accion')
    setCampaignNotes('')
    setCampaignIslandId('')
    setSelectedLocationIds([])
    setLocationFilter('')
    setDraftPrizes([])
    setEditingCampaignId(null)
    resetDraftPrizeForm()
    setCampaignMessage(null)
  }

  useEffect(() => {
    if (campaignType === 'accion' && selectedLocationIds.length > 1) {
      setSelectedLocationIds(selectedLocationIds.slice(0, 1))
    }
  }, [campaignType, selectedLocationIds])

  useEffect(() => {
    if (isCampaignBuilderOpen && editingCampaignId) {
      resetCampaignForm()
    }
  }, [isCampaignBuilderOpen])

  useEffect(() => {
    setSelectedLocationIds((previousSelection) =>
      previousSelection.filter((locationId) =>
        locations.some((location) => location.id === locationId),
      ),
    )
  }, [locations])

  useEffect(() => {
    if (!campaignIslandId) {
      return
    }

    if (!islands.some((island) => island.id === campaignIslandId)) {
      setCampaignIslandId('')
    }
  }, [campaignIslandId, islands])

  const toggleLocationSelection = (locationId: string) => {
    if (campaignType === 'accion') {
      setSelectedLocationIds([locationId])
      return
    }

    setSelectedLocationIds((previousSelection) =>
      previousSelection.includes(locationId)
        ? previousSelection.filter((entry) => entry !== locationId)
        : [...previousSelection, locationId],
    )
  }

  const handleCreateLocationSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedName = locationName.trim()
    const trimmedCity = locationCity.trim()

    if (!trimmedName || !trimmedCity) {
      setLocationMessage('Indica nombre del local y ciudad.')
      return
    }

    if (
      locations.some(
        (location) =>
          location.id !== editingLocationId &&
          location.name.trim().toLowerCase() === trimmedName.toLowerCase() &&
          location.city.trim().toLowerCase() === trimmedCity.toLowerCase(),
      )
    ) {
      setLocationMessage('Ya existe un local con ese nombre en esa ciudad.')
      return
    }

    if (editingLocationId) {
      onUpdateLocation(editingLocationId, trimmedName, trimmedCity)
      resetLocationForm()
      setLocationMessage('Local actualizado correctamente.')
      return
    }

    onCreateLocation(trimmedName, trimmedCity)
    resetLocationForm()
    setLocationMessage('Local creado correctamente.')
  }

  const handleEditLocationClick = (location: Location) => {
    setLocationName(location.name)
    setLocationCity(location.city)
    setEditingLocationId(location.id)
    setLocationMessage(null)
  }

  const handleDeleteLocationClick = (location: Location) => {
    const linkedCampaignCount = campaigns.filter((campaign) => campaign.locationIds.includes(location.id)).length

    if (
      !window.confirm(
        linkedCampaignCount
          ? `Se eliminara ${location.name} y se actualizaran ${linkedCampaignCount} operativas vinculadas. Continuar?`
          : `Se eliminara ${location.name}. Continuar?`,
      )
    ) {
      return
    }

    onDeleteLocation(location.id)

    if (editingLocationId === location.id) {
      resetLocationForm()
    }

    setLocationMessage('Local eliminado correctamente.')
  }

  const handleCreateIslandSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedName = islandName.trim()

    if (!trimmedName) {
      setIslandMessage('Indica un nombre para la isla.')
      return
    }

    if (
      islands.some(
        (island) =>
          island.id !== editingIslandId &&
          island.name.trim().toLowerCase() === trimmedName.toLowerCase(),
      )
    ) {
      setIslandMessage('Ya existe una isla con ese nombre.')
      return
    }

    if (editingIslandId) {
      onUpdateIsland(editingIslandId, trimmedName)
      resetIslandForm()
      setIslandMessage('Isla actualizada correctamente.')
      return
    }

    onCreateIsland(trimmedName)
    resetIslandForm()
    setIslandMessage('Isla creada correctamente.')
  }

  const handleEditIslandClick = (island: Island) => {
    setIslandName(island.name)
    setEditingIslandId(island.id)
    setIslandMessage(null)
  }

  const handleDeleteIslandClick = (island: Island) => {
    if (!window.confirm(`Se eliminara ${island.name} de la operativa. Continuar?`)) {
      return
    }

    onDeleteIsland(island.id)

    if (editingIslandId === island.id) {
      resetIslandForm()
    }

    setIslandMessage('Isla eliminada correctamente.')
  }

  const handleCategoryImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const file = input.files?.[0]

    if (!file) {
      setCategoryImageSrc(null)
      return
    }

    if (!file.type.startsWith('image/')) {
      setCategoryMessage('Selecciona una imagen valida para la categoria.')
      input.value = ''
      return
    }

    try {
      const nextImageSrc = await readImageAsDataUrl(file)
      setCategoryImageSrc(nextImageSrc)
      setCategoryMessage(null)
    } catch {
      setCategoryMessage('No se pudo cargar la foto de la categoria.')
    }

    input.value = ''
  }

  const handleCreatePrizeCategorySubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedName = categoryName.trim()

    if (!trimmedName) {
      setCategoryMessage('La categoria necesita un nombre.')
      return
    }

    if (
      prizeCategories.some(
        (prizeCategory) =>
          prizeCategory.id !== editingCategoryId &&
          prizeCategory.name.trim().toLowerCase() === trimmedName.toLowerCase(),
      )
    ) {
      setCategoryMessage('Ya existe una categoria con ese nombre.')
      return
    }

    const nextPrizeCategory = {
      id: editingCategoryId ?? createId('category'),
      name: trimmedName,
      description: categoryDescription.trim(),
      imageSrc: categoryImageSrc,
    }

    if (editingCategoryId) {
      onUpdatePrizeCategory(nextPrizeCategory)
      setDraftPrizes((previousPrizes) =>
        previousPrizes.map((prizeTemplate) =>
          prizeTemplate.categoryId === editingCategoryId
            ? {
                ...prizeTemplate,
                name: nextPrizeCategory.name,
                description: nextPrizeCategory.description,
                imageSrc: nextPrizeCategory.imageSrc,
              }
            : prizeTemplate,
        ),
      )
      resetCategoryForm()
      setCategoryMessage('Categoria actualizada correctamente.')
      return
    }

    onCreatePrizeCategory(nextPrizeCategory)
    resetCategoryForm()
    setCategoryMessage('Categoria creada correctamente.')
  }

  const handleEditPrizeCategoryClick = (prizeCategory: PrizeCategory) => {
    setCategoryName(prizeCategory.name)
    setCategoryDescription(prizeCategory.description)
    setCategoryImageSrc(prizeCategory.imageSrc)
    setEditingCategoryId(prizeCategory.id)
    setCategoryMessage(null)
  }

  const handleDeletePrizeCategoryClick = (prizeCategory: PrizeCategory) => {
    if (!window.confirm(`Se eliminara la categoria ${prizeCategory.name}. Continuar?`)) {
      return
    }

    onDeletePrizeCategory(prizeCategory.id)
    setDraftPrizes((previousPrizes) =>
      previousPrizes.map((prizeTemplate) =>
        prizeTemplate.categoryId === prizeCategory.id
          ? { ...prizeTemplate, categoryId: null }
          : prizeTemplate,
      ),
    )

    if (editingCategoryId === prizeCategory.id) {
      resetCategoryForm()
    }

    if (selectedPrizeCategoryId === prizeCategory.id) {
      resetDraftPrizeForm()
    }

    setCategoryMessage('Categoria eliminada correctamente.')
  }

  const handleAddDraftPrize = () => {
    const parsedStock = Number.parseInt(prizeStock, 10)
    const editingDraftPrize = editingDraftPrizeId
      ? draftPrizes.find((prizeTemplate) => prizeTemplate.id === editingDraftPrizeId) ?? null
      : null

    if (!selectedPrizeCategory) {
      setCampaignMessage('Selecciona una categoria de premio.')
      return
    }

    if (Number.isNaN(parsedStock) || parsedStock <= 0) {
      setCampaignMessage('La cantidad del premio debe ser mayor que cero.')
      return
    }

    if (prizeTimeMode === 'scheduled' && !draftWindows.length) {
      setCampaignMessage('Configura al menos una franja horaria para este premio.')
      return
    }

    if (
      draftPrizes.some(
        (prizeTemplate) =>
          prizeTemplate.categoryId === selectedPrizeCategory.id &&
          prizeTemplate.id !== editingDraftPrizeId,
      )
    ) {
      setCampaignMessage('Esta categoria ya esta añadida a la accion o ruta.')
      return
    }

    const nextPrizeTemplateBase = buildPrizeTemplateFromCategory(selectedPrizeCategory, parsedStock, {
      timeMode: prizeTimeMode,
      windows: draftWindows,
    })
    const nextPrizeTemplate: PrizeTemplate = {
      ...nextPrizeTemplateBase,
      id: editingDraftPrize?.id ?? nextPrizeTemplateBase.id,
      isEnabled: editingDraftPrize?.isEnabled ?? nextPrizeTemplateBase.isEnabled,
    }

    setDraftPrizes((previousPrizes) =>
      editingDraftPrize
        ? previousPrizes.map((prizeTemplate) =>
            prizeTemplate.id === editingDraftPrize.id ? nextPrizeTemplate : prizeTemplate,
          )
        : [...previousPrizes, nextPrizeTemplate],
    )
    resetDraftPrizeForm()
    setCampaignMessage(null)
  }

  const handleEditDraftPrizeClick = (prizeTemplate: PrizeTemplate) => {
    setEditingDraftPrizeId(prizeTemplate.id)
    setSelectedPrizeCategoryId(prizeTemplate.categoryId ?? '')
    setPrizeStock(String(prizeTemplate.stock))
    setPrizeTimeMode(prizeTemplate.timeMode)
    setDraftWindows(
      prizeTemplate.timeMode === 'scheduled'
        ? cloneDraftWindows(prizeTemplate.windows)
        : createDraftWindowSet(prizeTemplate.stock),
    )
    setCampaignMessage(null)
  }

  const handleDeleteDraftPrizeClick = (prizeId: string) => {
    setDraftPrizes((previousPrizes) => previousPrizes.filter((prizeTemplate) => prizeTemplate.id !== prizeId))

    if (editingDraftPrizeId === prizeId) {
      resetDraftPrizeForm()
    }

    setCampaignMessage(null)
  }

  const handleCreateCampaignSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const existingCampaign = editingCampaignId
      ? campaigns.find((campaign) => campaign.id === editingCampaignId) ?? null
      : null

    if (!campaignName.trim()) {
      setCampaignMessage('La accion o ruta necesita un nombre.')
      return
    }

    if (!campaignIslandId) {
      setCampaignMessage('Selecciona la isla de la operativa.')
      return
    }

    if (!selectedLocationIds.length) {
      setCampaignMessage('Selecciona al menos un local.')
      return
    }

    if (campaignType === 'accion' && selectedLocationIds.length !== 1) {
      setCampaignMessage('Una accion debe asociarse a un solo local.')
      return
    }

    if (!prizeCategories.length) {
      setCampaignMessage('Crea al menos una categoria de premio antes de guardar.')
      return
    }

    if (!draftPrizes.length) {
      setCampaignMessage('Agrega al menos un premio antes de guardar.')
      return
    }

    const nextCampaign: Campaign = {
      id: existingCampaign?.id ?? createId('campaign'),
      name: campaignName.trim(),
      type: campaignType,
      notes: campaignNotes.trim(),
      islandId: campaignIslandId,
      locationIds: [...selectedLocationIds],
      status: existingCampaign?.status ?? 'active',
      prizeTemplates: draftPrizes.map((prizeTemplate) => clonePrizeTemplateForEditor(prizeTemplate)),
    }

    if (existingCampaign) {
      onUpdateCampaign(nextCampaign)
    } else {
      onCreateCampaign(nextCampaign)
    }

    resetCampaignForm()
    setCampaignMessage(
      existingCampaign
        ? 'Configuracion actualizada correctamente.'
        : 'Configuracion guardada y activada.',
    )
  }

  const handleEditCampaignClick = (campaign: Campaign) => {
    onCloseCampaignBuilder()
    setEditingCampaignId(campaign.id)
    setCampaignName(campaign.name)
    setCampaignType(campaign.type)
    setCampaignNotes(campaign.notes)
    setCampaignIslandId(campaign.islandId ?? '')
    setSelectedLocationIds([...campaign.locationIds])
    setLocationFilter('')
    setDraftPrizes(campaign.prizeTemplates.map((prizeTemplate) => clonePrizeTemplateForEditor(prizeTemplate)))
    resetDraftPrizeForm()
    setCampaignMessage(null)
  }

  const handleCancelCampaignEdit = () => {
    resetCampaignForm()
    onCloseCampaignBuilder()
    setCampaignMessage(null)
  }

  useEffect(() => {
    if (!editingCampaignId) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCancelCampaignEdit()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [editingCampaignId])

  const handleAccessCodeSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = onUpdateAdminAccessCode(accessCodeCurrent, accessCodeNext)

    if (result) {
      setAccessCodeMessage(result)
      return
    }

    setAccessCodeCurrent('')
    setAccessCodeNext('')
    setAccessCodeMessage('Clave admin actualizada.')
  }

  const handleCampaignStatusChange = (campaign: Campaign, nextStatus: CampaignStatus) => {
    if (campaign.status === nextStatus) {
      return
    }

    if (
      nextStatus === 'closed' &&
      !window.confirm('La accion se cerrara y dejara de estar disponible en Inicio. Continuar?')
    ) {
      return
    }

    onUpdateCampaignStatus(campaign.id, nextStatus)
  }

  const handleDeleteCampaignClick = (campaign: Campaign) => {
    if (
      !window.confirm(
        `Se eliminara ${campaign.name}. Las activaciones abiertas de esta operativa se cerraran. Continuar?`,
      )
    ) {
      return
    }

    if (editingCampaignId === campaign.id) {
      handleCancelCampaignEdit()
    }

    onDeleteCampaign(campaign.id)
  }

  return (
    <main className="screen-grid screen-grid-admin">
      <section className="panel panel-wide">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Configuracion general</p>
            <h2 className="section-title">Locales y estructura base</h2>
          </div>
          <span className="status-chip accent">{currentUser.role === 'admin' ? 'Admin' : 'Desbloqueado'}</span>
        </div>

        <form className="stack-form" onSubmit={handleCreateLocationSubmit}>
          <div className="inline-fields">
            <label className="field-group">
              <span>Nombre del local</span>
              <input
                value={locationName}
                onChange={(event) => setLocationName(event.target.value)}
                placeholder="Ejemplo: Teatro Magno"
              />
            </label>

            <label className="field-group">
              <span>Ciudad</span>
              <input
                value={locationCity}
                onChange={(event) => setLocationCity(event.target.value)}
                placeholder="Ejemplo: Madrid"
              />
            </label>
          </div>

          {locationMessage ? <p className="form-message">{locationMessage}</p> : null}

          <div className="card-action-row">
            <button className="secondary-button" type="submit">
              {editingLocationId ? 'Guardar local' : 'Crear local'}
            </button>

            {editingLocationId ? (
              <button className="ghost-button" type="button" onClick={resetLocationForm}>
                Cancelar
              </button>
            ) : null}
          </div>
        </form>

        <div className="location-list">
          {locations.map((location) => (
            <article className="mini-panel" key={location.id}>
              <strong>{location.name}</strong>
              <span>{location.city}</span>
              <div className="card-action-row">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => handleEditLocationClick(location)}
                >
                  Editar
                </button>
                <button
                  className="ghost-button destructive-button"
                  type="button"
                  onClick={() => handleDeleteLocationClick(location)}
                >
                  Eliminar
                </button>
              </div>
            </article>
          ))}
        </div>

        <form className="stack-form" onSubmit={handleCreateIslandSubmit}>
          <label className="field-group">
            <span>Nombre de la isla</span>
            <input
              value={islandName}
              onChange={(event) => setIslandName(event.target.value)}
              placeholder="Ejemplo: Isla 1"
            />
          </label>

          {islandMessage ? <p className="form-message">{islandMessage}</p> : null}

          <div className="card-action-row">
            <button className="secondary-button" type="submit">
              {editingIslandId ? 'Guardar isla' : 'Crear isla'}
            </button>

            {editingIslandId ? (
              <button className="ghost-button" type="button" onClick={resetIslandForm}>
                Cancelar
              </button>
            ) : null}
          </div>
        </form>

        <div className="location-list">
          {islands.map((island) => (
            <article className="mini-panel" key={island.id}>
              <strong>{island.name}</strong>
              <span>Isla operativa</span>
              <div className="card-action-row">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => handleEditIslandClick(island)}
                >
                  Editar
                </button>
                <button
                  className="ghost-button destructive-button"
                  type="button"
                  onClick={() => handleDeleteIslandClick(island)}
                >
                  Eliminar
                </button>
              </div>
            </article>
          ))}
        </div>

        <div className="draft-block">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Categorias de premios</p>
              <h3 className="subsection-title">Crea el catalogo reusable</h3>
            </div>
          </div>

          <form className="stack-form nested-form" onSubmit={handleCreatePrizeCategorySubmit}>
            <label className="field-group">
              <span>Nombre de la categoria</span>
              <input
                value={categoryName}
                onChange={(event) => setCategoryName(event.target.value)}
                placeholder="Ejemplo: Sudadera Mahou"
              />
            </label>

            <label className="field-group">
              <span>Descripcion</span>
              <textarea
                rows={2}
                value={categoryDescription}
                onChange={(event) => setCategoryDescription(event.target.value)}
                placeholder="Condicion o copy corto del premio"
              />
            </label>

            <label className="field-group">
              <span>Foto de la categoria</span>
              <input type="file" accept="image/*" onChange={handleCategoryImageChange} />
            </label>

            {categoryImageSrc ? (
              <div className="prize-image-editor">
                <img className="prize-thumb prize-thumb-large" src={categoryImageSrc} alt="Vista previa de la categoria" />
                <button className="ghost-button" type="button" onClick={() => setCategoryImageSrc(null)}>
                  Quitar foto
                </button>
              </div>
            ) : null}

            {categoryMessage ? <p className="form-message">{categoryMessage}</p> : null}

            <div className="card-action-row">
              <button className="secondary-button" type="submit">
                {editingCategoryId ? 'Guardar categoria' : 'Crear categoria'}
              </button>

              {editingCategoryId ? (
                <button className="ghost-button" type="button" onClick={resetCategoryForm}>
                  Cancelar
                </button>
              ) : null}
            </div>
          </form>

          {prizeCategories.length ? (
            <div className="tag-row tag-row-list">
              {prizeCategories.map((prizeCategory) => (
                <article className="tag-card" key={prizeCategory.id}>
                  {prizeCategory.imageSrc ? (
                    <img className="prize-thumb" src={prizeCategory.imageSrc} alt={prizeCategory.name} />
                  ) : null}
                  <div>
                    <strong>{prizeCategory.name}</strong>
                    <p>{prizeCategory.description || 'Categoria reusable para acciones y rutas'}</p>
                  </div>
                  <div className="card-action-row">
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => handleEditPrizeCategoryClick(prizeCategory)}
                    >
                      Editar
                    </button>
                    <button
                      className="ghost-button destructive-button"
                      type="button"
                      onClick={() => handleDeletePrizeCategoryClick(prizeCategory)}
                    >
                      Eliminar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="always-on-box">Crea al menos una categoria para poder configurar premios por accion o ruta.</div>
          )}
        </div>
      </section>

      {isCampaignBuilderOpen || editingCampaignId ? (
        <>
          {editingCampaignId ? (
            <div className="campaign-detail-modal" onClick={handleCancelCampaignEdit} />
          ) : null}

          <section
            className={editingCampaignId ? 'panel panel-wide campaign-detail-modal-card' : 'panel panel-wide'}
            role={editingCampaignId ? 'dialog' : undefined}
            aria-modal={editingCampaignId ? 'true' : undefined}
            onClick={editingCampaignId ? (event) => event.stopPropagation() : undefined}
          >
          <div className="panel-header">
            <div>
              <h2 className="section-title campaign-builder-title">
                {editingCampaignId ? `Detalle de ${campaignName || 'la operativa'}` : 'Crear accion o ruta'}
              </h2>
            </div>

            {editingCampaignId ? (
              <button className="ghost-button" type="button" onClick={handleCancelCampaignEdit}>
                Cerrar detalle
              </button>
            ) : null}
          </div>

          <form className="stack-form" onSubmit={handleCreateCampaignSubmit}>
          <div className="inline-fields inline-fields-wide">
            <label className="field-group">
              <span>Nombre</span>
              <input
                value={campaignName}
                onChange={(event) => setCampaignName(event.target.value)}
                placeholder="Nombre de la accion o ruta"
              />
            </label>

            <label className="field-group">
              <span>Tipo</span>
              <select
                value={campaignType}
                onChange={(event) => setCampaignType(event.target.value as CampaignType)}
              >
                <option value="accion">Accion en un local</option>
                <option value="ruta">Ruta en varios locales</option>
              </select>
            </label>

            <label className="field-group">
              <span>Isla de la operativa</span>
              <select
                value={campaignIslandId}
                onChange={(event) => setCampaignIslandId(event.target.value)}
              >
                <option value="">Selecciona una isla</option>
                {islands.map((island) => (
                  <option key={island.id} value={island.id}>
                    {island.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field-group">
            <span>Notas operativas</span>
            <textarea
              rows={3}
              value={campaignNotes}
              onChange={(event) => setCampaignNotes(event.target.value)}
              placeholder="Describe el tono o condicion de la activacion"
            />
          </label>

          <div className="selector-block">
            <div className="selector-toolbar">
              <span className="selector-label">
                {campaignType === 'accion'
                  ? 'Selecciona el local de la accion'
                  : 'Selecciona los locales de la ruta'}
              </span>
              <span className="selector-summary">
                {campaignType === 'accion'
                  ? selectedLocationIds.length
                    ? '1 local seleccionado'
                    : 'Sin local seleccionado'
                  : `${selectedLocationIds.length} locales seleccionados`}
              </span>
            </div>

            <label className="field-group builder-location-filter">
              <span>Filtrar locales</span>
              <input
                value={locationFilter}
                onChange={(event) => setLocationFilter(event.target.value)}
                placeholder="Busca por nombre o ciudad"
              />
            </label>

            <div className="selector-grid">
              {filteredLocations.map((location) => {
                const isSelected = selectedLocationIds.includes(location.id)

                return (
                  <article
                    className={isSelected ? 'selector-card selector-card-active' : 'selector-card'}
                    key={location.id}
                  >
                    <div className="selector-card-body">
                      <strong>{location.name}</strong>
                      <span>{location.city}</span>
                    </div>
                    <button
                      className={isSelected ? 'secondary-button selector-select-button' : 'ghost-button selector-select-button'}
                      type="button"
                      onClick={() => toggleLocationSelection(location.id)}
                    >
                      {campaignType === 'accion'
                        ? isSelected
                          ? 'Seleccionado'
                          : 'Seleccionar'
                        : isSelected
                          ? 'Quitar'
                          : 'Seleccionar'}
                    </button>
                  </article>
                )
              })}
            </div>

            {filteredLocations.length ? null : (
              <div className="empty-state">No hay locales que coincidan con el filtro actual.</div>
            )}
          </div>

          <div className="draft-block">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Bolsa de premios</p>
                <h3 className="subsection-title">Asignar categorias a esta configuracion</h3>
              </div>
            </div>

            <div className="stack-form nested-form">
              <div className="inline-fields inline-fields-wide">
                <label className="field-group">
                  <span>Categoria</span>
                  <select
                    value={selectedPrizeCategoryId}
                    onChange={(event) => setSelectedPrizeCategoryId(event.target.value)}
                  >
                    <option value="">
                      {prizeCategories.length
                        ? 'Selecciona una categoria de premio'
                        : 'Crea primero una categoria de premio'}
                    </option>
                    {prizeCategories.map((prizeCategory) => (
                      <option key={prizeCategory.id} value={prizeCategory.id}>
                        {prizeCategory.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field-group">
                  <span>Cantidad</span>
                  <input
                    type="number"
                    min="1"
                    value={prizeStock}
                    onChange={(event) => setPrizeStock(event.target.value)}
                  />
                </label>

                <label className="field-group">
                  <span>Modo</span>
                  <select
                    value={prizeTimeMode}
                    onChange={(event) => {
                      const nextMode = event.target.value as PrizeTimeMode
                      setPrizeTimeMode(nextMode)

                      if (nextMode === 'scheduled' && !draftWindows.length) {
                        const currentDraftStock = Number.parseInt(prizeStock, 10)

                        setDraftWindows([
                          createScheduleWindow(
                            'Franja 1',
                            '18:00',
                            '21:00',
                            Number.isNaN(currentDraftStock) ? 1 : Math.max(currentDraftStock, 1),
                          ),
                        ])
                      }
                    }}
                  >
                    <option value="always">Siempre activo</option>
                    <option value="scheduled">Por franja horaria</option>
                  </select>
                </label>
              </div>

              {selectedPrizeCategory ? (
                <article className="tag-card">
                  {selectedPrizeCategory.imageSrc ? (
                    <img className="prize-thumb" src={selectedPrizeCategory.imageSrc} alt={selectedPrizeCategory.name} />
                  ) : null}
                  <div>
                    <strong>{selectedPrizeCategory.name}</strong>
                    <p>{selectedPrizeCategory.description || 'Categoria seleccionada para esta operativa'}</p>
                  </div>
                </article>
              ) : null}

              {campaignType === 'ruta' ? (
                <div className="always-on-box route-pool-note">
                  La ruta usa un pool de regalos propio e independiente de las ubicaciones.
                  Las franjas horarias liberan cupos sobre el stock total de la ruta y el sobrante
                  pasa a la siguiente franja activa.
                </div>
              ) : null}

              {prizeTimeMode === 'scheduled' ? (
                <WindowEditor windows={draftWindows} onChange={setDraftWindows} />
              ) : null}

              <button
                className="secondary-button"
                type="button"
                onClick={handleAddDraftPrize}
                disabled={!prizeCategories.length}
              >
                {editingDraftPrizeId ? 'Guardar cambios del premio' : 'Anadir premio a la bolsa'}
              </button>

              {editingDraftPrizeId ? (
                <button className="ghost-button" type="button" onClick={resetDraftPrizeForm}>
                  Cancelar edicion del premio
                </button>
              ) : null}
            </div>

            {draftPrizes.length ? (
              <div className="tag-row tag-row-list">
                {draftPrizes.map((prize) => (
                  <article className="tag-card" key={prize.id}>
                    {prize.imageSrc ? (
                      <img className="prize-thumb" src={prize.imageSrc} alt={prize.name} />
                    ) : null}
                    <div>
                      <strong>{prize.name}</strong>
                      <p>{prize.description || (prize.imageSrc ? 'Foto cargada' : 'Sin descripcion')}</p>
                    </div>
                    <span>{prize.stock} uds. · {prize.timeMode === 'always' ? 'Siempre activo' : 'Por franjas'}</span>
                    <div className="card-action-row">
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => handleEditDraftPrizeClick(prize)}
                      >
                        Editar premio
                      </button>
                      <button
                        className="ghost-button destructive-button"
                        type="button"
                        onClick={() => handleDeleteDraftPrizeClick(prize.id)}
                      >
                        Quitar
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </div>

          {campaignMessage ? <p className="form-message">{campaignMessage}</p> : null}

          <div className="card-action-row">
            <button className="primary-button" type="submit">
              {editingCampaignId ? 'Guardar cambios de la operativa' : 'Guardar configuracion base'}
            </button>

            {editingCampaignId ? (
              <button className="ghost-button" type="button" onClick={handleCancelCampaignEdit}>
                Cancelar
              </button>
            ) : null}
          </div>
          </form>
          </section>
        </>
      ) : null}

      <section className="panel panel-wide">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Claves</p>
            <h2 className="section-title">Actualizar contrasena admin</h2>
          </div>
        </div>

        <form className="stack-form" onSubmit={handleAccessCodeSubmit}>
          <div className="inline-fields inline-fields-wide">
            <label className="field-group">
              <span>Clave actual</span>
              <input
                type="password"
                value={accessCodeCurrent}
                onChange={(event) => setAccessCodeCurrent(event.target.value)}
              />
            </label>

            <label className="field-group">
              <span>Nueva clave admin</span>
              <input
                type="password"
                value={accessCodeNext}
                onChange={(event) => setAccessCodeNext(event.target.value)}
              />
            </label>
          </div>

          {accessCodeMessage ? <p className="form-message">{accessCodeMessage}</p> : null}

          <button className="secondary-button" type="submit">
            Actualizar clave
          </button>
        </form>
      </section>

      <section className="panel panel-wide">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Base creada</p>
            <h2 className="section-title">Acciones y rutas configuradas</h2>
          </div>
        </div>

        <div className="campaign-list">
          {manageableCampaigns.map((campaign) => (
            <article
              className="campaign-card campaign-card-clickable"
              key={campaign.id}
              role="button"
              tabIndex={0}
              onClick={() => handleEditCampaignClick(campaign)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  handleEditCampaignClick(campaign)
                }
              }}
            >
              <div className="campaign-card-head">
                <div>
                  <span className="campaign-pill">
                    {campaign.type === 'accion' ? 'Accion' : 'Ruta'}
                  </span>
                  <h3>{campaign.name}</h3>
                  <span className="mini-label">Pulsa para ver detalle y editar</span>
                </div>
                <div
                  className="campaign-card-controls"
                  onClick={(event) => event.stopPropagation()}
                >
                  <label className="field-group campaign-status-field">
                    <span>Estado</span>
                    <select
                      className="campaign-status-select"
                      value={campaign.status}
                      onChange={(event) =>
                        handleCampaignStatusChange(campaign, event.target.value as CampaignStatus)
                      }
                    >
                      <option value="active">Activa</option>
                      <option value="paused">Pausada</option>
                      <option value="closed">Cerrada</option>
                    </select>
                  </label>

                  <button
                    className="ghost-button destructive-button"
                    type="button"
                    onClick={() => handleDeleteCampaignClick(campaign)}
                  >
                    Eliminar
                  </button>
                </div>
              </div>
              <span className={campaign.status === 'active' ? 'status-chip accent' : 'status-chip'}>
                {getCampaignStatusLabel(campaign.status)}
              </span>
              <p>{getIslandName(campaign.islandId, islands)}</p>
              <p>{formatLocationList(campaign.locationIds, locations)}</p>
              <p>{campaign.notes || 'Sin notas operativas.'}</p>
                            {campaign.type === 'ruta' ? (
                              <div className="always-on-box route-pool-note">
                                Pool de regalos independiente de la ruta. Las franjas liberan cupos acumulables
                                sobre el stock total.
                              </div>
                            ) : null}
              <div className="tag-row tag-row-list">
                {campaign.prizeTemplates.map((prize) => (
                  <article className="tag-card" key={prize.id}>
                    {prize.imageSrc ? (
                      <img className="prize-thumb" src={prize.imageSrc} alt={prize.name} />
                    ) : null}
                    <div>
                      <strong>{prize.name}</strong>
                      <p>{prize.timeMode === 'always' ? 'Siempre activo' : 'Premio por franjas'}</p>
                    </div>
                    <span>{prize.stock} uds.</span>
                  </article>
                ))}
              </div>
            </article>
          ))}

          {manageableCampaigns.length ? null : (
            <div className="empty-state">No hay acciones o rutas configuradas todavia.</div>
          )}
        </div>
      </section>

      <section className="panel panel-wide">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Logs</p>
            <h2 className="section-title">Resultados de activaciones</h2>
          </div>
        </div>

        {loggedSessions.length ? (
          <div className="log-list">
            {loggedSessions.map((session) => {
              const spinLogs = getSessionSpinLogs(session)
              const spinSummary = summarizeSpinLogs(spinLogs)

              return (
                <article className="log-card" key={session.id}>
                  <div className="campaign-card-head">
                    <div>
                      <span className="campaign-pill">
                        {session.campaignType === 'accion' ? 'Accion' : 'Ruta'}
                      </span>
                      <h3>{session.campaignName}</h3>
                    </div>
                    <span className={session.status === 'completed' ? 'status-chip accent' : 'status-chip'}>
                      {session.status === 'completed' ? 'Cerrada' : 'Abierta'}
                    </span>
                  </div>

                  <p>
                    {formatLogTimestamp(session.startedAt)} · {formatLocationList(session.locationIds, locations)}
                  </p>
                  <p>Promotores: {session.promoterNames.join(', ')}</p>

                  <div className="tag-row tag-row-list">
                    <span className="tag">{spinLogs.length} giros</span>
                    {spinSummary.map((entry) => (
                      <span className="tag" key={`${session.id}-${entry.name}`}>
                        {entry.name} x{entry.count}
                      </span>
                    ))}
                  </div>

                  {spinLogs.length ? (
                    <div className="log-entry-list">
                      {spinLogs.map((spinLog) => (
                        <article className="log-entry" key={spinLog.id}>
                          <div>
                            <strong>{spinLog.prizeName}</strong>
                            <span>{formatLogTimestamp(spinLog.awardedAt)}</span>
                          </div>
                          {spinLog.prizeImageSrc ? (
                            <img className="prize-thumb" src={spinLog.prizeImageSrc} alt={spinLog.prizeName} />
                          ) : null}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="always-on-box">Sin premios entregados en esta activacion.</div>
                  )}
                </article>
              )
            })}
          </div>
        ) : (
          <div className="empty-state">Todavia no hay resultados registrados de activaciones.</div>
        )}
      </section>
    </main>
  )
}

function ActivationRoute({
  locations,
  sessions,
  now,
  canManageSession,
  onUpdatePrize,
  onConsumePrize,
  onFinishSession,
}: {
  locations: Location[]
  sessions: ActivationSession[]
  now: Date
  canManageSession: boolean
  onUpdatePrize: (
    sessionId: string,
    templateId: string,
    updater: (prize: ActivationPrize) => ActivationPrize,
  ) => void
  onConsumePrize: (sessionId: string, prize: ActivationPrize) => void
  onFinishSession: (sessionId: string) => void
}) {
  const { sessionId } = useParams()
  const session = sessions.find((entry) => entry.id === sessionId)

  if (!session) {
    return <Navigate to="/" replace />
  }

  return (
    <ActivationScreen
      locations={locations}
      session={session}
      now={now}
      canManageSession={canManageSession}
      onUpdatePrize={onUpdatePrize}
      onConsumePrize={onConsumePrize}
      onFinishSession={onFinishSession}
    />
  )
}

function ActivationScreen({
  locations,
  session,
  now,
  canManageSession,
  onUpdatePrize,
  onConsumePrize,
  onFinishSession,
}: {
  locations: Location[]
  session: ActivationSession
  now: Date
  canManageSession: boolean
  onUpdatePrize: (
    sessionId: string,
    templateId: string,
    updater: (prize: ActivationPrize) => ActivationPrize,
  ) => void
  onConsumePrize: (sessionId: string, prize: ActivationPrize) => void
  onFinishSession: (sessionId: string) => void
}) {
  const navigate = useNavigate()
  const timeoutRef = useRef<number | null>(null)
  const livePrizes = getLivePrizes(session, now)
  const [spinDegrees, setSpinDegrees] = useState(0)
  const [isSpinning, setIsSpinning] = useState(false)
  const [isManualConfigOpen, setIsManualConfigOpen] = useState(false)
  const [splashResult, setSplashResult] = useState<{
    name: string
    imageSrc: string | null
  } | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const handleSpin = () => {
    if (isSpinning || !livePrizes.length) {
      return
    }

    const chosenPrize = drawPrize(session, now, livePrizes)

    if (!chosenPrize) {
      return
    }

    setSplashResult(null)
    setIsSpinning(true)
    setSpinDegrees((previousRotation) => {
      const randomOffset = Math.floor(Math.random() * 360)
      return previousRotation + 2160 + randomOffset
    })

    timeoutRef.current = window.setTimeout(() => {
      onConsumePrize(session.id, chosenPrize)
      setSplashResult({
        name: chosenPrize.name,
        imageSrc: chosenPrize.imageSrc ?? null,
      })
      setIsSpinning(false)
    }, 4200)
  }

  const handleFinish = () => {
    if (!window.confirm('La activacion pasara a completada. Quieres cerrarla?')) {
      return
    }

    onFinishSession(session.id)
  }

  return (
    <main className="screen-grid screen-grid-activation">
      <section className="panel panel-wide activation-main-panel">
        <div className="activation-toolbar">
          <div>
            <p className="eyebrow">Pantalla de ruleta</p>
            <h2 className="section-title">{session.campaignName}</h2>
            <p className="panel-copy">
              {[formatLocationList(session.locationIds, locations), session.islandName, session.promoterNames.join(', ')]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="activation-toolbar-actions">
            <span className="campaign-pill">
              {session.campaignType === 'accion' ? 'Accion' : 'Ruta'}
            </span>
            <button className="ghost-button" type="button" onClick={() => navigate('/')}>
              Volver al menu
            </button>
            <button className="ghost-button" type="button" onClick={handleFinish}>
              Cerrar activacion
            </button>
          </div>
        </div>

        <div className="activation-roulette-layout">
          <div className="wheel-experience">
            <button
              className="wheel-trigger"
              type="button"
              disabled={!livePrizes.length || isSpinning}
              onClick={handleSpin}
              aria-label="Pulsa la ruleta para girar"
            >
              <span className="wheel-pointer" />
              <div
                className="wheel"
                style={{
                  backgroundImage: buildWheelGradient(12),
                  transform: `rotate(${spinDegrees}deg)`,
                }}
              />
              <div className="wheel-center wheel-center-logo">
                <img className="wheel-logo-m" src={assetPath('brands/mahou-logo-m-white.png')} alt="Mahou" />
              </div>
            </button>

            <p className="wheel-hint">
              {isSpinning
                ? 'Girando...'
                : livePrizes.length
                  ? 'Pulsa sobre la ruleta para girar'
                  : 'No hay premios activos en esta franja horaria'}
            </p>
          </div>

          <div className="activation-side">
            <div className="panel-copy">
              <strong>Premios posibles</strong>
            </div>

            <div className="possible-prize-list">
              {livePrizes.length ? (
                livePrizes.map((prize) => (
                  <article className="possible-prize-card" key={prize.templateId}>
                    {prize.imageSrc ? (
                      <img className="possible-prize-thumb" src={prize.imageSrc} alt={prize.name} />
                    ) : null}
                    <strong>{prize.name}</strong>
                  </article>
                ))
              ) : (
                <div className="always-on-box">No hay premios posibles en esta franja.</div>
              )}
            </div>
          </div>
        </div>
      </section>

      {canManageSession ? (
        <section className="panel panel-wide">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Configuracion manual</p>
              <h2 className="section-title">Activa premios y franjas en esta activacion</h2>
            </div>
            <button
              className="ghost-button panel-toggle"
              type="button"
              aria-expanded={isManualConfigOpen}
              onClick={() => setIsManualConfigOpen((previousState) => !previousState)}
            >
              {isManualConfigOpen ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>

          {isManualConfigOpen ? (
            <div className="config-grid">
              {session.prizes.map((prize) => {
                const liveNow = livePrizes.some(
                  (activePrize) => activePrize.templateId === prize.templateId,
                )

                return (
                  <article className={liveNow ? 'prize-config live' : 'prize-config'} key={prize.templateId}>
                    <div className="campaign-card-head">
                      <div>
                        <strong>{prize.name}</strong>
                      </div>
                      <span className={liveNow ? 'chip-button active' : 'chip-button'}>
                        {liveNow ? 'Activo ahora' : 'En espera'}
                      </span>
                    </div>

                    <div className="inline-fields inline-fields-wide">
                      <label className="field-group field-toggle">
                        <span>Activo en la sesion</span>
                        <input
                          type="checkbox"
                          checked={prize.isEnabled}
                          onChange={(event) =>
                            onUpdatePrize(session.id, prize.templateId, (currentPrize) => ({
                              ...currentPrize,
                              isEnabled: event.target.checked,
                            }))
                          }
                        />
                      </label>

                      <label className="field-group">
                        <span>Stock restante</span>
                        <input
                          type="number"
                          min="0"
                          value={prize.remainingStock}
                          onChange={(event) => {
                            const parsedValue = Number.parseInt(event.target.value, 10)

                            onUpdatePrize(session.id, prize.templateId, (currentPrize) => ({
                              ...currentPrize,
                              remainingStock: Number.isNaN(parsedValue)
                                ? 0
                                : Math.max(parsedValue, 0),
                            }))
                          }}
                        />
                      </label>

                      <label className="field-group">
                        <span>Modo horario</span>
                        <select
                          value={prize.timeMode}
                          onChange={(event) => {
                            const nextMode = event.target.value as PrizeTimeMode

                            onUpdatePrize(session.id, prize.templateId, (currentPrize) => ({
                              ...currentPrize,
                              timeMode: nextMode,
                              windows:
                                nextMode === 'scheduled'
                                  ? currentPrize.windows.length
                                    ? currentPrize.windows
                                    : [
                                        createScheduleWindow(
                                          'Franja 1',
                                          '18:00',
                                          '21:00',
                                          Math.max(currentPrize.remainingStock, 1),
                                        ),
                                      ]
                                  : [],
                            }))
                          }}
                        >
                          <option value="always">Siempre activo</option>
                          <option value="scheduled">Por franja horaria</option>
                        </select>
                      </label>
                    </div>

                    {prize.timeMode === 'scheduled' ? (
                      <WindowEditor
                        windows={prize.windows}
                        onChange={(nextWindows) =>
                          onUpdatePrize(session.id, prize.templateId, (currentPrize) => ({
                            ...currentPrize,
                            windows: nextWindows,
                          }))
                        }
                      />
                    ) : (
                      <div className="always-on-box">Premio disponible sin restriccion horaria.</div>
                    )}

                    {prize.timeMode === 'scheduled' && prize.windows.length ? (
                      <div className="tag-row tag-row-list">
                        {prize.windows.map((windowSlot) => (
                          <span className={isWindowActive(windowSlot, now) ? 'tag active' : 'tag'} key={windowSlot.id}>
                            {windowSlot.label}: {windowSlot.start} - {windowSlot.end}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
          ) : null}
        </section>
      ) : null}

      {splashResult ? (
        <div className="result-splash" role="dialog" aria-modal="true">
          <div className="result-splash-card">
            <img className="splash-logo" src={assetPath('brands/mahou-logo-white.png')} alt="Mahou" />
            <p className="eyebrow">Resultado</p>
            {splashResult.imageSrc ? (
              <img className="splash-prize-image" src={splashResult.imageSrc} alt={splashResult.name} />
            ) : null}
            <h2 className="section-title">{splashResult.name}</h2>
            <button className="primary-button" type="button" onClick={() => setSplashResult(null)}>
              Continuar
            </button>
          </div>
        </div>
      ) : null}
    </main>
  )
}

function WindowEditor({
  windows,
  onChange,
}: {
  windows: ScheduleWindow[]
  onChange: (windows: ScheduleWindow[]) => void
}) {
  const updateWindow = (
    windowId: string,
    patch: Partial<ScheduleWindow>,
  ) => {
    onChange(
      windows.map((windowSlot) =>
        windowSlot.id === windowId ? { ...windowSlot, ...patch } : windowSlot,
      ),
    )
  }

  return (
    <div className="window-editor">
      <div className="window-list">
        {windows.map((windowSlot, index) => (
          <div className="window-row" key={windowSlot.id}>
            <label className="field-group">
              <span>Etiqueta</span>
              <input
                value={windowSlot.label}
                onChange={(event) => updateWindow(windowSlot.id, { label: event.target.value })}
                placeholder={`Franja ${index + 1}`}
              />
            </label>

            <label className="field-group">
              <span>Inicio</span>
              <input
                type="time"
                value={windowSlot.start}
                onChange={(event) => updateWindow(windowSlot.id, { start: event.target.value })}
              />
            </label>

            <label className="field-group">
              <span>Fin</span>
              <input
                type="time"
                value={windowSlot.end}
                onChange={(event) => updateWindow(windowSlot.id, { end: event.target.value })}
              />
            </label>

            <label className="field-group">
              <span>Cupo</span>
              <input
                type="number"
                min="0"
                value={windowSlot.quota}
                onChange={(event) => {
                  const parsedQuota = Number.parseInt(event.target.value, 10)

                  updateWindow(windowSlot.id, {
                    quota: Number.isNaN(parsedQuota) ? 0 : Math.max(parsedQuota, 0),
                  })
                }}
              />
            </label>

            <label className="field-group field-toggle compact-toggle">
              <span>On</span>
              <input
                type="checkbox"
                checked={windowSlot.enabled}
                onChange={(event) => updateWindow(windowSlot.id, { enabled: event.target.checked })}
              />
            </label>

            <button
              className="icon-button"
              type="button"
              onClick={() => onChange(windows.filter((entry) => entry.id !== windowSlot.id))}
            >
              Eliminar
            </button>
          </div>
        ))}
      </div>

      <button
        className="ghost-button"
        type="button"
        onClick={() =>
          onChange([
            ...windows,
            createScheduleWindow(
              `Franja ${windows.length + 1}`,
              '18:00',
              '21:00',
              Math.max(windows.length ? windows[windows.length - 1].quota : 1, 1),
            ),
          ])
        }
      >
        Anadir franja
      </button>
    </div>
  )
}

function buildWheelGradient(segmentCount: number): string {
  const safeCount = Math.max(segmentCount, 2)
  const stops = Array.from({ length: safeCount }, (_, index) => {
    const start = (360 / safeCount) * index
    const end = (360 / safeCount) * (index + 1)
    const color = index % 2 === 0 ? '#c8102e' : '#ffffff'

    return `${color} ${start}deg ${end}deg`
  })

  return `conic-gradient(${stops.join(', ')})`
}

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('No se pudo leer la imagen.'))
    }

    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'))
    reader.readAsDataURL(file)
  })
}
