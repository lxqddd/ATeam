import { useEffect, useState } from 'react'
import { Segmented } from 'antd'
import { useTranslation } from 'react-i18next'
import {
  getLanguagePreference,
  setLanguagePreference,
  supportedLanguages,
  type LanguagePreference
} from '../../i18n'

function LanguageSettings(): React.JSX.Element {
  const { i18n, t } = useTranslation()
  const [preference, setPreference] = useState<LanguagePreference>(getLanguagePreference)

  useEffect(() => {
    const handleLanguageChanged = (): void => {
      setPreference(getLanguagePreference())
    }

    i18n.on('languageChanged', handleLanguageChanged)
    return () => {
      i18n.off('languageChanged', handleLanguageChanged)
    }
  }, [i18n])

  const options: Array<{ value: LanguagePreference; label: string }> = [
    { value: 'system', label: t('settings.languageSystem') },
    ...supportedLanguages.map((language) => ({
      value: language.code,
      label: language.label
    }))
  ]

  function handleChange(next: LanguagePreference): void {
    setPreference(next)
    setLanguagePreference(next)
  }

  return (
    <Segmented
      aria-label={t('settings.interfaceLanguage')}
      options={options}
      value={preference}
      onChange={(value) => handleChange(value as LanguagePreference)}
    />
  )
}

export default LanguageSettings
