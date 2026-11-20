import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getLanguagePreference,
  setLanguagePreference,
  supportedLanguages,
  type LanguagePreference
} from '../../i18n'
import SegmentedControl, { type SegmentedOption } from './SegmentedControl'

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

  const options: Array<SegmentedOption<LanguagePreference>> = [
    { value: 'system', label: t('settings.languageSystem'), testId: 'locale-system' },
    ...supportedLanguages.map((language) => ({
      value: language.code,
      label: language.label,
      testId: `locale-${language.code}`
    }))
  ]

  function handleChange(next: LanguagePreference): void {
    setPreference(next)
    setLanguagePreference(next)
  }

  return (
    <SegmentedControl
      ariaLabel={t('settings.interfaceLanguage')}
      options={options}
      value={preference}
      onChange={handleChange}
    />
  )
}

export default LanguageSettings
