import { useTranslation } from 'react-i18next'
import { supportedLanguages } from '../i18n'

function LanguageSwitcher(): React.JSX.Element {
  const { i18n, t } = useTranslation()

  return (
    <label
      className="inline-flex items-center gap-2 text-[13px] text-zinc-600 dark:text-zinc-400"
      htmlFor="language-select"
    >
      <span>{t('common.language')}</span>
      <select
        id="language-select"
        className="cursor-pointer rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus-visible:outline-zinc-400"
        value={i18n.language}
        onChange={(event) => void i18n.changeLanguage(event.target.value)}
      >
        {supportedLanguages.map((language) => (
          <option key={language.code} value={language.code}>
            {language.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export default LanguageSwitcher
