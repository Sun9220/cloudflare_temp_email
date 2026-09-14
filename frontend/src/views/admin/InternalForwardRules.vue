<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
// @ts-ignore
import { api } from '../../api'

type InternalForwardRule = {
  id: string
  name: string
  source: string
  destination: string
  includeKeywords: string[]
  excludeKeywords: string[]
  searchSubject: boolean
  searchText: boolean
  searchHtml: boolean
  enabled: boolean
}

const message = useMessage()
const loading = ref(false)
const rules = ref<InternalForwardRule[]>([])

const newId = () => {
  try {
    return crypto.randomUUID()
  } catch (_) {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

const createRule = (): InternalForwardRule => ({
  id: newId(),
  name: '',
  source: '',
  destination: '',
  includeKeywords: [],
  excludeKeywords: [],
  searchSubject: true,
  searchText: true,
  searchHtml: true,
  enabled: true,
})

const addRule = () => {
  rules.value.push(createRule())
}

const removeRule = (index: number) => {
  rules.value.splice(index, 1)
}

const normalizeRule = (rule: any): InternalForwardRule => ({
  id: typeof rule?.id === 'string' && rule.id ? rule.id : newId(),
  name: typeof rule?.name === 'string' ? rule.name : '',
  source: typeof rule?.source === 'string' ? rule.source : '',
  destination: typeof rule?.destination === 'string' ? rule.destination : '',
  includeKeywords: Array.isArray(rule?.includeKeywords) ? rule.includeKeywords : [],
  excludeKeywords: Array.isArray(rule?.excludeKeywords) ? rule.excludeKeywords : [],
  searchSubject: rule?.searchSubject !== false,
  searchText: rule?.searchText !== false,
  searchHtml: rule?.searchHtml !== false,
  enabled: rule?.enabled !== false,
})

const fetchRules = async () => {
  loading.value = true
  try {
    const res = await api.fetch('/admin/config/internal_forward_rules') as { value?: string | null }
    if (!res?.value) {
      rules.value = []
      return
    }
    const parsed = JSON.parse(res.value)
    rules.value = Array.isArray(parsed) ? parsed.map(normalizeRule) : []
  } catch (error) {
    message.error((error as Error).message || '读取内部转发规则失败')
  } finally {
    loading.value = false
  }
}

const validateRules = () => {
  for (let index = 0; index < rules.value.length; index += 1) {
    const rule = rules.value[index]
    const number = index + 1
    if (!rule.source.trim() || !rule.source.includes('@')) {
      throw new Error(`规则 ${number}：请输入有效的来源邮箱`)
    }
    if (!rule.destination.trim() || !rule.destination.includes('@')) {
      throw new Error(`规则 ${number}：请输入有效的目标邮箱`)
    }
    if (rule.source.trim().toLowerCase() === rule.destination.trim().toLowerCase()) {
      throw new Error(`规则 ${number}：来源邮箱和目标邮箱不能相同`)
    }
    if (!rule.includeKeywords.map(item => item.trim()).filter(Boolean).length) {
      throw new Error(`规则 ${number}：至少添加一个包含关键词`)
    }
    if (!rule.searchSubject && !rule.searchText && !rule.searchHtml) {
      throw new Error(`规则 ${number}：至少选择一个匹配位置`)
    }
  }
}

const saveRules = async () => {
  try {
    validateRules()
    loading.value = true
    const payload = rules.value.map(rule => ({
      ...rule,
      name: rule.name.trim(),
      source: rule.source.trim(),
      destination: rule.destination.trim(),
      includeKeywords: rule.includeKeywords.map(item => item.trim()).filter(Boolean),
      excludeKeywords: rule.excludeKeywords.map(item => item.trim()).filter(Boolean),
    }))
    await api.fetch('/admin/config', {
      method: 'POST',
      body: JSON.stringify({
        key: 'internal_forward_rules',
        value: JSON.stringify(payload),
      }),
    })
    rules.value = payload
    message.success('内部转发规则已保存，后续收到的新邮件立即按新规则处理')
  } catch (error) {
    message.error((error as Error).message || '保存失败')
  } finally {
    loading.value = false
  }
}

onMounted(fetchRules)
</script>

<template>
  <div class="internal-forward-page">
    <n-card title="内部邮件筛选 / 转发" :bordered="false" embedded>
      <n-alert type="info" style="margin-bottom: 16px;">
        原邮箱会正常保留全部邮件。只有命中“包含关键词”且未命中“排除关键词”的邮件，才会在本系统内部复制一份到目标邮箱；不会经过 Resend 或外部 SMTP。
      </n-alert>

      <n-flex justify="space-between" align="center" style="margin-bottom: 16px;">
        <n-text depth="3">规则修改后立即生效，不需要重新部署 Worker。</n-text>
        <n-space>
          <n-button @click="addRule">新增规则</n-button>
          <n-button type="primary" :loading="loading" @click="saveRules">保存全部规则</n-button>
        </n-space>
      </n-flex>

      <n-empty v-if="!rules.length && !loading" description="暂无内部转发规则">
        <template #extra>
          <n-button type="primary" @click="addRule">创建第一条规则</n-button>
        </template>
      </n-empty>

      <n-space v-else vertical size="large">
        <n-card v-for="(rule, index) in rules" :key="rule.id" size="small">
          <template #header>
            <n-flex align="center">
              <n-text strong>规则 {{ index + 1 }}</n-text>
              <n-tag v-if="rule.name" size="small" :bordered="false">{{ rule.name }}</n-tag>
            </n-flex>
          </template>
          <template #header-extra>
            <n-space align="center">
              <n-switch v-model:value="rule.enabled" :round="false">
                <template #checked>启用</template>
                <template #unchecked>停用</template>
              </n-switch>
              <n-button type="error" tertiary size="small" @click="removeRule(index)">删除</n-button>
            </n-space>
          </template>

          <n-grid :cols="2" :x-gap="16" responsive="screen" item-responsive>
            <n-grid-item span="2 m:1">
              <n-form-item label="规则名称（可选）">
                <n-input v-model:value="rule.name" placeholder="例如：登录验证码转发" />
              </n-form-item>
            </n-grid-item>
            <n-grid-item span="2 m:1">
              <n-form-item label="状态">
                <n-text>{{ rule.enabled ? '启用：新邮件会执行此规则' : '停用：暂不执行' }}</n-text>
              </n-form-item>
            </n-grid-item>
            <n-grid-item span="2 m:1">
              <n-form-item label="来源邮箱 A">
                <n-input v-model:value="rule.source" placeholder="A@xhsh.de" />
              </n-form-item>
            </n-grid-item>
            <n-grid-item span="2 m:1">
              <n-form-item label="目标邮箱 B">
                <n-input v-model:value="rule.destination" placeholder="B@xhsh.de" />
              </n-form-item>
            </n-grid-item>
          </n-grid>

          <n-form-item label="包含关键词（命中任意一个即可）">
            <n-select
              v-model:value="rule.includeKeywords"
              multiple
              tag
              filterable
              :show-arrow="false"
              placeholder="输入关键词后回车，例如：登录验证码、login code、sign-in code"
            />
          </n-form-item>

          <n-form-item label="排除关键词（命中任意一个则不转发）">
            <n-select
              v-model:value="rule.excludeKeywords"
              multiple
              tag
              filterable
              :show-arrow="false"
              placeholder="例如：修改密码、邮箱变更、登录提醒"
            />
          </n-form-item>

          <n-form-item label="关键词匹配位置">
            <n-space>
              <n-checkbox v-model:checked="rule.searchSubject">标题 Subject</n-checkbox>
              <n-checkbox v-model:checked="rule.searchText">纯文本正文</n-checkbox>
              <n-checkbox v-model:checked="rule.searchHtml">HTML 正文</n-checkbox>
            </n-space>
          </n-form-item>

          <n-alert type="default" :show-icon="false">
            {{ rule.source || 'A@xhsh.de' }} → {{ rule.destination || 'B@xhsh.de' }}：先匹配包含词，再检查排除词。目标邮箱必须已在 tempmail 中创建。
          </n-alert>
        </n-card>
      </n-space>
    </n-card>
  </div>
</template>

<style scoped>
.internal-forward-page {
  max-width: 1000px;
  margin: 0 auto;
  text-align: left;
}
</style>
