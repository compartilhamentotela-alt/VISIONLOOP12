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
- Formatos aceitos no upload: `.mp4`, `.webm`, `.mkv`, `.mov`, `.avi`
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
→ A partir desta versão, todo upload feito pelo controlador é convertido para HD (1280x720, H.264 Main + AAC + faststart), o que resolve a maioria dos travamentos causados por codec incompatível, resolução alta demais ou vídeos sem o índice no início do arquivo.
→ A TV agora também detecta sozinha quando um vídeo "congela" (sem erro explícito) e pula para o próximo automaticamente.
→ Se o vídeo foi colocado manualmente na pasta `videos/` (sem passar pelo upload), ele não foi convertido — recomenda-se subir pelo controlador para garantir compatibilidade.

**Porta 3000 em uso**
→ Edite `server.js` e mude `const PORT = 3000` para outra porta (ex: 3001)

**`npm install` demorando ou falhando**
→ A conversão de vídeo usa o pacote `ffmpeg-static`, que baixa um binário do FFmpeg (~80MB) na primeira instalação. Isso exige conexão com a internet só nesse passo — depois disso o servidor funciona 100% offline na rede local.
