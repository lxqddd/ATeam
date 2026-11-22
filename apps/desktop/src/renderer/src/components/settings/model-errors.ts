import { errorMessage } from '../../lib/errors'

export function modelErrorMessage(t: (key: string) => string, error: unknown): string {
  const message = errorMessage(error)
  switch (message) {
    case 'API_KEY_REQUIRED':
      return t('settings.apiKeyRequired')
    case 'BASE_URL_REQUIRED':
      return t('settings.baseURLRequired')
    case 'INVALID_BASE_URL':
      return t('settings.invalidBaseURL')
    case 'MODEL_EXISTS':
      return t('settings.modelExists')
    case 'PROVIDER_NOT_FOUND':
      return t('settings.providerNotFound')
    case 'MODEL_NOT_FOUND':
      return t('settings.modelNotFound')
    case 'INVALID_OAUTH_CONFIG':
      return t('settings.invalidOAuthConfig')
    case 'OAUTH_UNSUPPORTED_PROVIDER':
      return t('settings.oauthUnsupportedProvider')
    case 'OAUTH_NOT_CONFIGURED':
      return t('settings.oauthNotConfigured')
    case 'INVALID_VARIANT':
      return t('settings.invalidVariant')
    case 'NAME_REQUIRED':
      return t('settings.nameRequired')
    case 'ENCRYPTION_UNAVAILABLE':
      return t('settings.encryptionUnavailable')
    default:
      return message
  }
}
