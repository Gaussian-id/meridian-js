<script setup lang="ts">
// A leak on purpose: the server entry imported by a component that ships to the browser.
import { useMeridianServerClient } from 'meridian-nuxt/server'

const send = () => useMeridianServerClient().chat.create({ messages: [{ role: 'user', content: 'hi' }] })
</script>

<template>
  <button @click="send">Send</button>
</template>
