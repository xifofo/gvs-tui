import { PROVIDER_NAME, type Card, type Provider, type SearchGroup } from './api'

export type SearchSourceKey = Provider | 'migu-app' | 'migu-tv'
export type SearchSource = { key: SearchSourceKey; provider: Provider; name: string }
export type SearchSourceGroup = SearchGroup & SearchSource

/** Presentation sources retain the real provider for authorization and IPC. */
export function providerSearchSources(provider: Provider): SearchSource[] {
  return provider === 'migu'
    ? [{key:'migu-app',provider,name:'咪咕 App'},{key:'migu-tv',provider,name:'咪咕 TV（咪视界）'}]
    : [{key:provider,provider,name:PROVIDER_NAME[provider]}]
}

export function cardSourceKey(card: Pick<Card, 'provider' | 'id' | 'sourceTerminal'>): SearchSourceKey {
  if (card.provider !== 'migu') return card.provider
  return card.sourceTerminal === 'tv' || card.id.startsWith('tv:') || card.id.startsWith('tv-series:') ? 'migu-tv' : 'migu-app'
}

export function cardSourceName(card: Pick<Card, 'provider' | 'id' | 'sourceTerminal'>): string {
  return providerSearchSources(card.provider).find(source => source.key === cardSourceKey(card))!.name
}

export function splitSearchSources(groups: SearchGroup[]): SearchSourceGroup[] {
  return groups.flatMap(group => providerSearchSources(group.provider).map(source => ({
    ...source,
    cards: group.cards.filter(card => cardSourceKey(card) === source.key),
    error: group.error,
  })))
}
