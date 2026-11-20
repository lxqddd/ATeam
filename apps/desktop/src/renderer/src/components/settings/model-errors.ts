export function modelErrorMessage(t: (key: string) => string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
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
    case 'NAME_REQUIRED':
      return t('settings.nameRequired')
    case 'ENCRYPTION_UNAVAILABLE':
      return t('settings.encryptionUnavailable')
    default:
      return message
  }
}
