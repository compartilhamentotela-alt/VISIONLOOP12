# 🎬 VisionLoop v0.0.7b+ — Novas Funcionalidades

## ✨ Suporte a Imagens e Tempo de Exibição Configurável

A versão atualizada do VisionLoop agora oferece suporte completo para imagens e permite configurar o tempo de exibição de cada item na playlist.

### 📸 Formatos Suportados

#### Vídeos
- `.mp4` — MPEG-4 Video
- `.webm` — WebM Video
- `.mkv` — Matroska Video
- `.mov` — QuickTime Video
- `.avi` — Audio Video Interleave

#### Imagens (NOVO!)
- `.jpg` / `.jpeg` — JPEG Image
- `.png` — PNG Image
- `.gif` — Animated GIF
- `.webp` — WebP Image

### 🎯 Como Usar Imagens

#### 1. Fazer Upload de Imagens

Na aba **"Vídeos"** do controlador:

1. Clique na zona de upload (ou arraste arquivos)
2. Selecione uma ou mais imagens (`.jpg`, `.png`, `.gif`, `.webp`)
3. Aguarde o upload ser concluído
4. A imagem aparecerá na grade de vídeos com um ícone de 🖼 (moldura)

#### 2. Usar Imagens em Playlists

Na aba **"Playlists"**:

1. Clique em **"+ Nova Playlist"**
2. Digite um nome para a playlist
3. Clique nas imagens e vídeos para adicioná-los à playlist
4. **Para imagens**, um campo de tempo aparecerá na lista de reprodução
5. Configure o tempo em **segundos** (padrão: 10s)
6. Salve a playlist

#### 3. Reproduzir Playlist com Imagens

1. Selecione a playlist criada
2. Escolha uma TV na lista suspensa
3. Clique em **"▶ Iniciar Playlist"**
4. As imagens serão exibidas pelo tempo configurado e depois passarão para o próximo item

### ⏱️ Configuração de Tempo

#### Para Vídeos
- O tempo é **automático** — o vídeo toca até o final
- Não há campo de entrada de tempo

#### Para Imagens
- Tempo **configurável** em segundos
- Intervalo: **1 a 300 segundos** (5 minutos máximo)
- **Padrão**: 10 segundos por imagem
- Você pode alterar o tempo a qualquer momento ao editar a playlist

### 📋 Exemplo de Playlist Mista

```
1. 🎬 VID_20260616_150633.mp4  (vídeo — toca até o final)
2. 🖼 logo.png • 5s             (imagem — exibe por 5 segundos)
3. 🎬 VID_20260618_212941.mp4  (vídeo — toca até o final)
4. 🖼 banner.jpg • 15s          (imagem — exibe por 15 segundos)
```

### 🔄 Compatibilidade com Versões Anteriores

- Playlists antigas (apenas com vídeos) continuam funcionando
- O sistema detecta automaticamente se é imagem ou vídeo
- Imagens antigas recebem tempo padrão de 10 segundos

### 🖥️ Transmissão em Massa

Você pode transmitir imagens e vídeos para todas as TVs simultaneamente:

1. Selecione uma imagem ou vídeo na grade
2. Clique em **"📡 Transmitir para todas as TVs"**
3. O arquivo será reproduzido em todas as TVs conectadas

### 🎨 Dicas de Uso

1. **Cardápio Digital**: Use imagens de produtos com tempo de 15-30 segundos
2. **Apresentações**: Combine slides (como imagens PNG) com vídeos de transição
3. **Publicidade**: Alterne entre vídeos promocionais e imagens estáticas
4. **Informações**: Exiba gráficos e tabelas (como PNG) por tempo suficiente para leitura

### 📝 Notas Técnicas

- Imagens são servidas com cache de 1 hora para melhor performance
- O suporte a imagens funciona em todos os navegadores modernos
- Tamanho máximo recomendado: 5MB por arquivo
- Resolução recomendada: 1920x1080 (Full HD) ou superior

### 🐛 Troubleshooting

**P: A imagem não aparece na TV**
- Verifique se o arquivo está em um formato suportado (.jpg, .png, .gif, .webp)
- Certifique-se de que o arquivo foi carregado com sucesso (ícone ✓)

**P: O tempo não está funcionando**
- Verifique se você configurou um tempo entre 1 e 300 segundos
- Edite a playlist e confirme o tempo novamente

**P: Posso misturar vídeos e imagens na mesma playlist?**
- Sim! Você pode adicionar quantos vídeos e imagens quiser na mesma playlist

---

**Versão**: 0.0.7b+  
**Data**: Junho 2026  
**Desenvolvido por**: VisionLoop Team
