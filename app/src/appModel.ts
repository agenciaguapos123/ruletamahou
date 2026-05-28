export type UserRole = 'admin' | 'operator'
export type CampaignType = 'accion' | 'ruta'
export type CampaignStatus = 'active' | 'paused' | 'closed'
export type PrizeTimeMode = 'always' | 'scheduled'

export interface AppUser {
  id: string
  username: string
  password: string
  displayName: string
  role: UserRole
}

export interface Location {
  id: string
  name: string
  city: string
  islandId: string | null
}

export interface Island {
  id: string
  name: string
}

export interface PrizeCategory {
  id: string
  name: string
  description: string
  imageSrc: string | null
}

export interface ScheduleWindow {
  id: string
  label: string
  start: string
  end: string
  enabled: boolean
  quota: number
}

export interface PrizeTemplate {
  id: string
  categoryId: string | null
  name: string
  description: string
  imageSrc: string | null
  stock: number
  isEnabled: boolean
  timeMode: PrizeTimeMode
  windows: ScheduleWindow[]
}

export interface Campaign {
  id: string
  name: string
  type: CampaignType
  notes: string
  islandId: string | null
  locationIds: string[]
  status: CampaignStatus
  prizeTemplates: PrizeTemplate[]
}

export interface ActivationPrize {
  templateId: string
  name: string
  description: string
  imageSrc: string | null
  totalStock: number
  remainingStock: number
  isEnabled: boolean
  timeMode: PrizeTimeMode
  windows: ScheduleWindow[]
}

export interface ActivationSpinLog {
  id: string
  prizeTemplateId: string
  prizeName: string
  prizeImageSrc: string | null
  awardedAt: string
}

export interface ActivationSession {
  id: string
  campaignId: string
  campaignName: string
  campaignType: CampaignType
  locationIds: string[]
  islandId: string | null
  islandName: string | null
  promoterNames: string[]
  startedAt: string
  status: 'live' | 'completed'
  prizes: ActivationPrize[]
  spinLogs: ActivationSpinLog[]
  lastPrizeId: string | null
  lastPrizeName: string | null
  lastSpinAt: string | null
}

export interface AppState {
  users: AppUser[]
  adminAccessCode: string
  locations: Location[]
  islands: Island[]
  prizeCategories: PrizeCategory[]
  campaigns: Campaign[]
  sessions: ActivationSession[]
}

const STORAGE_KEY = 'mahou-roulette-app-state'
const SESSION_KEY = 'mahou-roulette-current-user'

export function createId(prefix = 'mahou'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now()}`
}

export function createScheduleWindow(
  label = 'Prime time',
  start = '18:00',
  end = '21:00',
  quota = 1,
): ScheduleWindow {
  return {
    id: createId('window'),
    label,
    start,
    end,
    enabled: true,
    quota: Math.max(Math.floor(quota), 0),
  }
}

function cloneWindows(windows: ScheduleWindow[]): ScheduleWindow[] {
  return windows.map((windowSlot) => ({
    ...windowSlot,
    id: createId('window'),
    quota: Math.max(Math.floor(windowSlot.quota ?? 0), 0),
  }))
}

function normalizeScheduleWindow(windowSlot: ScheduleWindow, fallbackQuota: number): ScheduleWindow {
  return {
    ...windowSlot,
    quota:
      typeof windowSlot.quota === 'number' && Number.isFinite(windowSlot.quota)
        ? Math.max(Math.floor(windowSlot.quota), 0)
        : Math.max(Math.floor(fallbackQuota), 0),
  }
}

function sanitizePrizeDescription(description: unknown): string {
  if (typeof description !== 'string') {
    return ''
  }

  return description.trim() === 'Premio directo para trafico de tardeo.' ? '' : description
}

function normalizePrizeCategory(prizeCategory: PrizeCategory): PrizeCategory {
  return {
    ...prizeCategory,
    description: sanitizePrizeDescription(prizeCategory.description),
    imageSrc: typeof prizeCategory.imageSrc === 'string' ? prizeCategory.imageSrc : null,
  }
}

function normalizeCampaignStatus(status: unknown, legacyIsEnabled?: unknown): CampaignStatus {
  if (status === 'active' || status === 'paused' || status === 'closed') {
    return status
  }

  return legacyIsEnabled === false ? 'paused' : 'active'
}

function normalizePrizeTemplate(prizeTemplate: PrizeTemplate): PrizeTemplate {
  return {
    ...prizeTemplate,
    categoryId: typeof prizeTemplate.categoryId === 'string' ? prizeTemplate.categoryId : null,
    description: sanitizePrizeDescription(prizeTemplate.description),
    imageSrc: typeof prizeTemplate.imageSrc === 'string' ? prizeTemplate.imageSrc : null,
    windows: Array.isArray(prizeTemplate.windows)
      ? prizeTemplate.windows.map((windowSlot) =>
          normalizeScheduleWindow(windowSlot as ScheduleWindow, prizeTemplate.stock),
        )
      : [],
  }
}

function normalizeCampaign(campaign: Campaign & { isEnabled?: boolean }): Campaign {
  const { prizeTemplates, isEnabled, ...rest } = campaign

  return {
    ...rest,
    islandId: typeof campaign.islandId === 'string' ? campaign.islandId : null,
    status: normalizeCampaignStatus(campaign.status, isEnabled),
    prizeTemplates: Array.isArray(prizeTemplates)
      ? prizeTemplates.map((prizeTemplate) => normalizePrizeTemplate(prizeTemplate as PrizeTemplate))
      : [],
  }
}

function normalizeActivationPrize(prize: ActivationPrize): ActivationPrize {
  const totalStock =
    typeof prize.totalStock === 'number' && Number.isFinite(prize.totalStock)
      ? Math.max(Math.floor(prize.totalStock), 0)
      : Math.max(Math.floor(prize.remainingStock ?? 0), 0)

  return {
    ...prize,
    description: sanitizePrizeDescription(prize.description),
    imageSrc: typeof prize.imageSrc === 'string' ? prize.imageSrc : null,
    totalStock,
    remainingStock:
      typeof prize.remainingStock === 'number' && Number.isFinite(prize.remainingStock)
        ? Math.max(Math.floor(prize.remainingStock), 0)
        : totalStock,
    windows: Array.isArray(prize.windows)
      ? prize.windows.map((windowSlot) =>
          normalizeScheduleWindow(windowSlot as ScheduleWindow, totalStock),
        )
      : [],
  }
}

function normalizeSpinLog(spinLog: ActivationSpinLog): ActivationSpinLog {
  return {
    id: typeof spinLog.id === 'string' ? spinLog.id : createId('spin'),
    prizeTemplateId:
      typeof spinLog.prizeTemplateId === 'string' ? spinLog.prizeTemplateId : createId('prize'),
    prizeName: typeof spinLog.prizeName === 'string' ? spinLog.prizeName : 'Premio',
    prizeImageSrc: typeof spinLog.prizeImageSrc === 'string' ? spinLog.prizeImageSrc : null,
    awardedAt:
      typeof spinLog.awardedAt === 'string' ? spinLog.awardedAt : new Date().toISOString(),
  }
}

function normalizeActivationSession(session: ActivationSession): ActivationSession {
  return {
    ...session,
    status: session.status === 'completed' ? 'completed' : 'live',
    islandId: typeof session.islandId === 'string' ? session.islandId : null,
    islandName: typeof session.islandName === 'string' ? session.islandName : null,
    prizes: Array.isArray(session.prizes)
      ? session.prizes.map((prize) => normalizeActivationPrize(prize as ActivationPrize))
      : [],
    spinLogs: Array.isArray(session.spinLogs)
      ? session.spinLogs.map((spinLog) => normalizeSpinLog(spinLog as ActivationSpinLog))
      : [],
    lastPrizeId: typeof session.lastPrizeId === 'string' ? session.lastPrizeId : null,
    lastPrizeName: typeof session.lastPrizeName === 'string' ? session.lastPrizeName : null,
    lastSpinAt: typeof session.lastSpinAt === 'string' ? session.lastSpinAt : null,
  }
}

function inferLocationIslandId(
  location: Partial<Location>,
  campaigns: Campaign[],
): string | null {
  if (typeof location.islandId === 'string') {
    return location.islandId
  }

  if (typeof location.id !== 'string') {
    return null
  }

  const actionIslandIds = new Set(
    campaigns
      .filter(
        (campaign) =>
          campaign.type === 'accion' &&
          campaign.locationIds.includes(location.id as string) &&
          typeof campaign.islandId === 'string',
      )
      .map((campaign) => campaign.islandId as string),
  )

  if (actionIslandIds.size === 1) {
    return Array.from(actionIslandIds)[0]
  }

  const islandIds = new Set(
    campaigns
      .filter(
        (campaign) =>
          campaign.locationIds.includes(location.id as string) && typeof campaign.islandId === 'string',
      )
      .map((campaign) => campaign.islandId as string),
  )

  return islandIds.size === 1 ? Array.from(islandIds)[0] : null
}

function normalizeLocation(location: Location, campaigns: Campaign[]): Location {
  return {
    ...location,
    islandId: inferLocationIslandId(location, campaigns),
  }
}

function seedLocations(islands: Island[]): Location[] {
  const primaryIslandId = islands[0]?.id ?? null
  const secondaryIslandId = islands[1]?.id ?? primaryIslandId

  return [
    {
      id: createId('location'),
      name: 'Mercado de San Ildefonso',
      city: 'Madrid',
      islandId: primaryIslandId,
    },
    { id: createId('location'), name: 'La Tape', city: 'Madrid', islandId: secondaryIslandId },
    { id: createId('location'), name: 'Sala Mon', city: 'Madrid', islandId: secondaryIslandId },
  ]
}

function seedIslands(): Island[] {
  return [
    { id: createId('island'), name: 'Isla 1' },
    { id: createId('island'), name: 'Isla 2' },
    { id: createId('island'), name: 'Isla 3' },
  ]
}

function seedPrizeCategories(): PrizeCategory[] {
  return [
    {
      id: createId('category'),
      name: 'Camiseta Mahou',
      description: '',
      imageSrc: null,
    },
    {
      id: createId('category'),
      name: 'Pack consumicion',
      description: 'Solo activo en la franja fuerte del afterwork.',
      imageSrc: null,
    },
    {
      id: createId('category'),
      name: 'Abridor Mahou',
      description: 'Premio always-on para mantener giro constante.',
      imageSrc: null,
    },
    {
      id: createId('category'),
      name: 'Entrada concierto',
      description: 'Se desbloquea solo en la parte final de la ruta.',
      imageSrc: null,
    },
  ]
}

export function buildPrizeTemplateFromCategory(
  prizeCategory: PrizeCategory,
  stock: number,
  options?: {
    timeMode?: PrizeTimeMode
    windows?: ScheduleWindow[]
  },
): PrizeTemplate {
  const timeMode = options?.timeMode ?? 'always'

  return {
    id: createId('prize'),
    categoryId: prizeCategory.id,
    name: prizeCategory.name,
    description: prizeCategory.description,
    imageSrc: prizeCategory.imageSrc,
    stock,
    isEnabled: true,
    timeMode,
    windows: timeMode === 'scheduled' ? cloneWindows(options?.windows ?? []) : [],
  }
}

function derivePrizeCategoriesFromCampaigns(campaigns: Campaign[]): PrizeCategory[] {
  const categoryMap = new Map<string, PrizeCategory>()

  campaigns.forEach((campaign) => {
    campaign.prizeTemplates.forEach((prizeTemplate) => {
      const categoryId =
        typeof prizeTemplate.categoryId === 'string' && prizeTemplate.categoryId
          ? prizeTemplate.categoryId
          : null
      const key =
        categoryId ??
        [prizeTemplate.name, sanitizePrizeDescription(prizeTemplate.description), prizeTemplate.imageSrc ?? ''].join('::')

      if (categoryMap.has(key)) {
        return
      }

      categoryMap.set(key, {
        id: categoryId ?? createId('category'),
        name: prizeTemplate.name,
        description: sanitizePrizeDescription(prizeTemplate.description),
        imageSrc: typeof prizeTemplate.imageSrc === 'string' ? prizeTemplate.imageSrc : null,
      })
    })
  })

  return Array.from(categoryMap.values())
}

function seedCampaigns(
  locationIds: string[],
  prizeCategories: PrizeCategory[],
  islands: Island[],
): Campaign[] {
  const categoryMap = new Map(prizeCategories.map((prizeCategory) => [prizeCategory.name, prizeCategory]))
  const tshirtCategory = categoryMap.get('Camiseta Mahou') ?? prizeCategories[0]
  const drinkCategory = categoryMap.get('Pack consumicion') ?? prizeCategories[1] ?? prizeCategories[0]
  const openerCategory = categoryMap.get('Abridor Mahou') ?? prizeCategories[2] ?? prizeCategories[0]
  const ticketCategory = categoryMap.get('Entrada concierto') ?? prizeCategories[3] ?? prizeCategories[0]
  const primaryIslandId = islands[0]?.id ?? null
  const secondaryIslandId = islands[1]?.id ?? primaryIslandId

  return [
    {
      id: createId('campaign'),
      name: 'Mahou Tardeo Chamberi',
      type: 'accion',
      notes: 'Activacion de un unico local con foco en captacion y dinamica inmediata.',
      islandId: primaryIslandId,
      locationIds: [locationIds[0]],
      status: 'active',
      prizeTemplates: [
        buildPrizeTemplateFromCategory(tshirtCategory, 20),
        buildPrizeTemplateFromCategory(drinkCategory, 16, {
          timeMode: 'scheduled',
          windows: [createScheduleWindow('Afterwork', '19:00', '22:00', 16)],
        }),
      ],
    },
    {
      id: createId('campaign'),
      name: 'Ruta Roja Centro',
      type: 'ruta',
      notes: 'Ruta multi local para mover publico entre varios puntos de consumo.',
      islandId: secondaryIslandId,
      locationIds: [locationIds[1], locationIds[2]],
      status: 'active',
      prizeTemplates: [
        buildPrizeTemplateFromCategory(openerCategory, 40),
        buildPrizeTemplateFromCategory(ticketCategory, 10, {
          timeMode: 'scheduled',
          windows: [createScheduleWindow('Cierre', '21:30', '23:30', 10)],
        }),
      ],
    },
  ]
}

export function createDefaultState(): AppState {
  const islands = seedIslands()
  const locations = seedLocations(islands)
  const prizeCategories = seedPrizeCategories()

  return {
    users: [
      {
        id: createId('user'),
        username: 'admin',
        password: 'mahou2026',
        displayName: 'Administrador Mahou',
        role: 'admin',
      },
      {
        id: createId('user'),
        username: 'promotor',
        password: 'mahou2026',
        displayName: 'Promotor Mahou',
        role: 'operator',
      },
    ],
    adminAccessCode: 'mahou-admin',
    locations,
    islands,
    prizeCategories,
    campaigns: seedCampaigns(
      locations.map((location) => location.id),
      prizeCategories,
      islands,
    ),
    sessions: [],
  }
}

function normalizeStoredAppState(parsedState: Partial<AppState>): AppState {
  const defaultState = createDefaultState()
  const campaigns = Array.isArray(parsedState.campaigns)
    ? parsedState.campaigns.map((campaign) =>
        normalizeCampaign(campaign as Campaign & { isEnabled?: boolean }),
      )
    : defaultState.campaigns
  const derivedPrizeCategories = derivePrizeCategoriesFromCampaigns(campaigns)
  const prizeCategories = Array.isArray(parsedState.prizeCategories)
    ? parsedState.prizeCategories.map((prizeCategory) =>
        normalizePrizeCategory(prizeCategory as PrizeCategory),
      )
    : derivedPrizeCategories.length
      ? derivedPrizeCategories
      : defaultState.prizeCategories

  return {
    users: Array.isArray(parsedState.users) && parsedState.users.length
      ? parsedState.users
      : defaultState.users,
    adminAccessCode:
      typeof parsedState.adminAccessCode === 'string'
        ? parsedState.adminAccessCode
        : defaultState.adminAccessCode,
    locations: Array.isArray(parsedState.locations)
      ? parsedState.locations.map((location) =>
          normalizeLocation(location as Location, campaigns),
        )
      : defaultState.locations,
    islands: Array.isArray(parsedState.islands)
      ? parsedState.islands
      : defaultState.islands,
    prizeCategories,
    campaigns,
    sessions: Array.isArray(parsedState.sessions)
      ? parsedState.sessions.map((session) =>
          normalizeActivationSession(session as ActivationSession),
        )
      : [],
  }
}

export function importAppState(rawState: string): AppState {
  const parsedValue = JSON.parse(rawState) as Partial<AppState> | { state?: Partial<AppState> }

  if (!parsedValue || typeof parsedValue !== 'object') {
    throw new Error('Invalid backup payload.')
  }

  const nextState =
    'state' in parsedValue && parsedValue.state && typeof parsedValue.state === 'object'
      ? parsedValue.state
      : parsedValue

  return normalizeStoredAppState(nextState as Partial<AppState>)
}

export function loadAppState(): AppState {
  if (typeof window === 'undefined') {
    return createDefaultState()
  }

  try {
    const rawState = window.localStorage.getItem(STORAGE_KEY)

    if (!rawState) {
      return createDefaultState()
    }

    const parsedState = JSON.parse(rawState) as Partial<AppState>
    return normalizeStoredAppState(parsedState)
  } catch {
    return createDefaultState()
  }
}

export function saveAppState(state: AppState): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function loadSessionUser(state: AppState): AppUser | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawUser = window.sessionStorage.getItem(SESSION_KEY)

    if (!rawUser) {
      return null
    }

    const parsedUser = JSON.parse(rawUser) as { id?: string }

    if (!parsedUser.id) {
      return null
    }

    return state.users.find((user) => user.id === parsedUser.id) ?? null
  } catch {
    return null
  }
}

export function saveSessionUser(user: AppUser | null): void {
  if (typeof window === 'undefined') {
    return
  }

  if (!user) {
    window.sessionStorage.removeItem(SESSION_KEY)
    return
  }

  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: user.id }))
}

export function parsePromoters(rawValue: string): string[] {
  return Array.from(
    new Set(
      rawValue
        .split(/[\n,;]+/)
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  )
}

export function buildActivationSession(
  campaign: Campaign,
  promoterNames: string[],
  island: Island,
): ActivationSession {
  return {
    id: createId('session'),
    campaignId: campaign.id,
    campaignName: campaign.name,
    campaignType: campaign.type,
    locationIds: [...campaign.locationIds],
    islandId: island.id,
    islandName: island.name,
    promoterNames,
    startedAt: new Date().toISOString(),
    status: 'live',
    prizes: campaign.prizeTemplates.map((prizeTemplate) => ({
      templateId: prizeTemplate.id,
      name: prizeTemplate.name,
      description: prizeTemplate.description,
      imageSrc: prizeTemplate.imageSrc,
      totalStock: prizeTemplate.stock,
      remainingStock: prizeTemplate.stock,
      isEnabled: prizeTemplate.isEnabled,
      timeMode: prizeTemplate.timeMode,
      windows: cloneWindows(prizeTemplate.windows),
    })),
    spinLogs: [],
    lastPrizeId: null,
    lastPrizeName: null,
    lastSpinAt: null,
  }
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map((chunk) => Number.parseInt(chunk, 10))

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return 0
  }

  return hours * 60 + minutes
}

export function isWindowActive(windowSlot: ScheduleWindow, now: Date): boolean {
  if (!windowSlot.enabled) {
    return false
  }

  const nowInMinutes = now.getHours() * 60 + now.getMinutes()
  const start = timeToMinutes(windowSlot.start)
  const end = timeToMinutes(windowSlot.end)

  if (start <= end) {
    return nowInMinutes >= start && nowInMinutes <= end
  }

  return nowInMinutes >= start || nowInMinutes <= end
}

function compareWindowOrder(left: ScheduleWindow, right: ScheduleWindow): number {
  return timeToMinutes(left.start) - timeToMinutes(right.start)
}

function getOrderedEnabledWindows(windows: ScheduleWindow[]): ScheduleWindow[] {
  return windows.filter((windowSlot) => windowSlot.enabled).sort(compareWindowOrder)
}

function countPrizeAwards(session: ActivationSession, templateId: string): number {
  return session.spinLogs.filter((spinLog) => spinLog.prizeTemplateId === templateId).length
}

function getCurrentActiveWindowIndex(windows: ScheduleWindow[], now: Date): number {
  return windows.reduce(
    (lastActiveIndex, windowSlot, index) =>
      isWindowActive(windowSlot, now) ? index : lastActiveIndex,
    -1,
  )
}

export function getPrizeAvailableCount(
  session: ActivationSession,
  prize: ActivationPrize,
  now: Date,
): number {
  if (!prize.isEnabled || prize.remainingStock <= 0) {
    return 0
  }

  if (prize.timeMode === 'always') {
    return prize.remainingStock
  }

  const orderedWindows = getOrderedEnabledWindows(prize.windows)
  const activeWindowIndex = getCurrentActiveWindowIndex(orderedWindows, now)

  if (activeWindowIndex === -1) {
    return 0
  }

  const releasedQuota = orderedWindows
    .slice(0, activeWindowIndex + 1)
    .reduce((sum, windowSlot) => sum + Math.max(windowSlot.quota, 0), 0)
  const awardedCount = countPrizeAwards(session, prize.templateId)

  return Math.max(0, Math.min(prize.remainingStock, releasedQuota - awardedCount))
}

export function isPrizeLive(session: ActivationSession, prize: ActivationPrize, now: Date): boolean {
  return getPrizeAvailableCount(session, prize, now) > 0
}

export function getLivePrizes(session: ActivationSession, now: Date): ActivationPrize[] {
  return session.prizes.filter((prize) => isPrizeLive(session, prize, now))
}

export function drawPrize(
  session: ActivationSession,
  now: Date,
  prizes = getLivePrizes(session, now),
): ActivationPrize | null {
  const totalWeight = prizes.reduce(
    (sum, prize) => sum + getPrizeAvailableCount(session, prize, now),
    0,
  )

  if (!prizes.length || totalWeight <= 0) {
    return null
  }

  let cursor = Math.random() * totalWeight

  for (const prize of prizes) {
    cursor -= getPrizeAvailableCount(session, prize, now)

    if (cursor <= 0) {
      return prize
    }
  }

  return prizes[prizes.length - 1]
}

export function formatLocationList(locationIds: string[], locations: Location[]): string {
  const names = locationIds
    .map((locationId) => locations.find((location) => location.id === locationId)?.name)
    .filter((name): name is string => Boolean(name))

  return names.length ? names.join(' · ') : 'Sin local asignado'
}