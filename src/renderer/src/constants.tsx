import { OpenAiLogoIcon } from '@phosphor-icons/react'
import { ClaudeIcon } from '@/components/ui/icons/claude'

export const AI_PROVIDERS = {
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    icon: OpenAiLogoIcon,
    openConversation: (conversationId: string) => {
      window.api?.shell.openExternal(`https://chatgpt.com/c/${conversationId}`)
    }
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    icon: ClaudeIcon,
    openConversation: (conversationId: string) => {
      window.api?.shell.openExternal(`https://claude.ai/chat/${conversationId}`)
    }
  }
} as const
