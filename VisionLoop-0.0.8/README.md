# 📺 VisionLoop

Sistema de controle de vídeo em loop para TVs via rede local.

## Como funciona

```
[PC Controlador] ←→ [Servidor Node.js] ←→ [TV 1]
                                       ←→ [TV 2]
                                       ←→ [TV 3...]
```

O servidor roda no seu PC e serve como intermediário. As TVs e o controlador se comunicam via WebSocket em tempo real.

---

## Requisitos

- [Node.js](https://nodejs.org) instalado no PC (versão 16 ou superior)
- PC e TVs na **mesma rede Wi-Fi/LAN**
- Navegador nas TVs (Chrome, Edge, ou Firefox)

---

## Instalação

1. Extraia esta pasta em qualquer lugar do seu PC
2. Abra o terminal na pasta e rode:

```bash
npm install
```

---

## Como usar

### 1. Inicie o servidor (PC)

```bash
npm start
```

Você verá no terminal:
```
✅ Servidor rodando em http://localhost:3000
📺 Controlador (PC): http://localhost:3000/controller.html
📺 TV receiver:      http://localhost:3000/tv.html
```

### 2. Adicione seus vídeos

Envie os vídeos pelo controlador (aba "Vídeos") ou coloque os arquivos direto na pasta `videos/`:
- Formatos aceitos no upload: `.mp4`, `.webm`
- **Todo vídeo enviado pelo controlador é automaticamente convertido para HD (1280x720)** em H.264/AAC otimizado para TV — isso evita travamentos por codec incompatível ou resolução alta demais. Vídeos colocados manualmente na pasta `videos/` não passam por essa conversão.

### 3. Conecte as TVs

Em cada TV, abra o navegador e acesse:
```
http://[IP-DO-SEU-PC]:3000/tv.html
```

Para descobrir o IP do seu PC:
- **Windows**: Abra o terminal e rode `ipconfig` → procure "Endereço IPv4"
- **Mac/Linux**: rode `ifconfig` ou `ip a`

Exemplo: `http://192.168.1.100:3000/tv.html`

Cada TV vai exibir um **código de 6 letras** único (ex: `ABC123`).

### 4. Abra o controlador (PC)

No seu PC, acesse:
```
http://localhost:3000
```

As TVs conectadas aparecem no painel esquerdo. Clique em uma para controlar.

---

## Funcionalidades

| Função | Descrição |
|--------|-----------|
| ▶ Reproduzir | Envia um vídeo para a TV selecionada |
| ⏸ Pausar | Pausa o vídeo na TV |
| ▶ Retomar | Retoma o vídeo pausado |
| ⏹ Parar | Para o vídeo e volta à tela de espera |
| 📡 Transmitir para todas | Envia o mesmo vídeo para todas as TVs ao mesmo tempo |
| Loop automático | O vídeo fica em loop infinito automaticamente |
| Nome da TV | Cada TV pode ter um nome personalizado |

---

## Dicas

- Para **tela cheia** na TV: pressione F11 no navegador, ou use o modo kiosk do Chrome:
  ```
  chrome --kiosk http://[IP]:3000/tv.html
  ```
- O sistema **reconecta automaticamente** se a conexão cair
- Suporta **quantas TVs quiser** — sem limite
- Os vídeos ficam em **loop infinito** até você enviar um comando de parar

---

## Solução de problemas

**TV não aparece no controlador**
→ Verifique se ambos estão na mesma rede Wi-Fi/LAN
→ Verifique o IP correto do PC no endereço da TV

**Vídeo não toca na TV**
→ Use formato `.mp4` com H.264
→ Verifique se o arquivo está na pasta `videos/`

**Vídeo trava e não volta mais**
→ Todo upload feito pelo controlador é convertido para HLS em HD (1280x720, H.264 Main + AAC, em segmentos de poucos segundos), o que resolve a maioria dos travamentos causados por codec incompatível, resolução alta demais ou arquivo único grande demais para a memória da TV.
→ A TV também usa um único player de vídeo (sem double buffering), evitando disputa pelo decodificador de hardware da TV, que só tem um.
→ Se mesmo assim um vídeo travar, a TV depende dos eventos nativos do navegador (`error`, `ended`) para se recuperar ou avançar — não há mais um watchdog reativo tentando "adivinhar" quando o vídeo travou.
→ Se o vídeo foi colocado manualmente na pasta `videos/` (sem passar pelo upload), ele não foi convertido — recomenda-se subir pelo controlador para garantir compatibilidade.

**Porta 3000 em uso**
→ Edite `server.js` e mude `const PORT = 3000` para outra porta (ex: 3001)

**`npm install` demorando ou falhando**
→ A conversão de vídeo usa o pacote `ffmpeg-static`, que baixa um binário do FFmpeg (~80MB) na primeira instalação. Isso exige conexão com a internet só nesse passo — depois disso o servidor funciona 100% offline na rede local.

---

## 📝 Changelog

### v0.0.8 — Simplificação do pipeline de vídeo e do player da TV

Três mudanças de estabilidade/limpeza de código, sem alterar o número de versão:

1. **Remoção da detecção de formatos antigos no servidor (`.mkv`, `.avi`, `.mov`)**
   - `server.js`: `MEDIA_EXT_REGEX` e `VIDEO_EXT_REGEX` agora só reconhecem `.mp4`/`.webm` como vídeo (além das extensões de imagem já suportadas). As entradas de MIME type para `.mkv`, `.mov` e `.avi` foram removidas.
   - Motivo: como todo vídeo enviado já chega (ou é convertido) em `.mp4`/`.webm` antes de passar por essa checagem, manter a detecção desses formatos antigos era código morto que só poluía o arquivo.
   - Reflexo na interface: `controller.html` (campo de upload, dica de formatos aceitos e mensagem de erro) e `NOVAS_FUNCIONALIDADES.md` foram atualizados para não citarem mais `.mkv`/`.mov`/`.avi`.

2. **Remoção do double buffering (dois players `<video>`) na TV**
   - `tv.html`: os elementos `playerA`/`playerB` foram substituídos por um único `<video id="player">`, reutilizado para tudo. As funções `activePlayer()`/`idlePlayer()` e a alternância de índice ativo foram removidas, assim como o pré-carregamento de vídeo em segundo plano (`preloadNextInPlaylist` agora só faz prefetch de **imagens**, que não usam o decodificador de vídeo).
   - Motivo: a maioria das Smart TVs tem só **um decodificador de hardware de vídeo**. Carregar um segundo vídeo em paralelo enquanto o primeiro tocava disputava esse recurso e era a causa provável dos travamentos por falta de memória.
   - Trade-off aceito: a troca entre vídeos da playlist deixa de ser instantânea (pode haver um pequeno fade/flash em preto ao trocar de fonte), em troca de estabilidade.

3. **Remoção do watchdog reativo (`armWatchdog`)**
   - `tv.html`: a checagem periódica que monitorava `currentTime` para detectar vídeo "congelado" e forçar reinício foi removida, junto com `clearWatchdog` e `handleStuckPlayback`.
   - Motivo: era uma solução para o sintoma (tentar reiniciar quando trava), não para a causa. Com a entrega em HLS (segmentos pequenos) e um player único sem disputa de decodificador, a origem mais comum do travamento deixa de existir. A recuperação de erros continua existindo, mas agora só via eventos nativos do `<video>` (`error`, `ended`), sem polling.
