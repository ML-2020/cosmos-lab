# 第三方组件与数据声明

`dist/index.html` 会把下面列出的第三方代码、数据与字体直接内嵌进同一个 HTML 文件。
各组件版权与许可全文如下；`README.md` 的「数据与致谢」是简版说明。

## 运行时库（内嵌在 `dist/index.html` 里）

### three.js 0.186.1

- 许可证：MIT
- 版权：Copyright © 2010-2026 three.js authors
- 项目：https://threejs.org

### astronomy-engine 2.1.19

- 许可证：MIT
- 版权：Copyright (c) 2019-2023 Don Cross <cosinekitty@gmail.com>
- 项目：https://github.com/cosinekitty/astronomy

MIT 许可全文见文末「MIT License」。

## 数据

### d3-celestial（恒星、星座、深空天体、银河）

- 许可证：BSD-3-Clause
- 版权：Copyright (c) 2015, Olaf Frohn
- 项目：https://github.com/ofrohn/d3-celestial
- 说明：本项目的星表、星座线、深空天体与银河数据由 d3-celestial 的数据文件生成
  （`data/` 与 `src/generated/`）。上游数据又编译自多个公开星表，具体来源见
  d3-celestial 仓库。

BSD 3-Clause 许可全文见文末。

### NASA 地球影像（Blue Marble / Black Marble / 云层等）

- 来源：NASA Visible Earth / NASA Earth Observatory
- 版权：NASA 图像一般不受美国版权保护（公有领域）。NASA 不为此项目背书。
- 相关文件：`assets/earth-blue-marble.jpg`、`assets/earth-night.jpg`、
  `assets/clouds.png`、`assets/earth-water.png`
- 使用条款：https://www.nasa.gov/nasa-brand-center/images-and-media/

### Natural Earth（海岸线与陆地轮廓）

- 来源：Natural Earth，经 world-atlas / topojson-client 生成 `src/generated/land.json`
- 版权：公有领域（public domain）
- 使用条款：https://www.naturalearthdata.com/about/terms-of-use/

## 构建工具（只在本地/CI 构建时使用，不进入 `dist/index.html`）

### esbuild 0.28.2

- 许可证：MIT
- 版权：Copyright (c) 2020 Evan Wallace

### world-atlas 2.0.2 与 topojson-client 3.1.0

- 许可证：ISC
- 版权：world-atlas Copyright 2013-2019 Michael Bostock；
  topojson-client Copyright 2012-2019 Michael Bostock

## 字体（按页面用字裁剪后以内嵌 woff2 形式包含在 `dist/index.html` 里）

### Noto Serif CJK SC Black（CSS 中重命名为 `Display`）

- 许可证：SIL Open Font License 1.1
- 版权：© Noto CJK / Source Han Serif 项目作者（Adobe、Google 及贡献者）
- 项目：https://github.com/notofonts/noto-cjk

### Bricolage Grotesque（CSS 中重命名为 `Bricolage`）

- 许可证：SIL Open Font License 1.1
- 版权：Copyright 2022 The Bricolage Grotesque Project Authors
  (https://github.com/ateliertriay/bricolage)
- 项目：https://github.com/ateliertriay/bricolage

SIL Open Font License 1.1 全文见文末。

---

## MIT License

Copyright notices for the MIT-licensed components:

- three.js: Copyright © 2010-2026 three.js authors
- astronomy-engine: Copyright (c) 2019-2023 Don Cross <cosinekitty@gmail.com>
- esbuild: Copyright (c) 2020 Evan Wallace

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## BSD 3-Clause License (d3-celestial)

Copyright (c) 2015, Olaf Frohn
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## ISC License (world-atlas, topojson-client)

Copyright 2013-2019 Michael Bostock (world-atlas)
Copyright 2012-2019 Michael Bostock (topojson-client)

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.

## SIL Open Font License 1.1 (Noto Serif CJK SC, Bricolage Grotesque)

Copyright notices for the OFL-licensed fonts:

- Noto Serif CJK SC: © Noto CJK / Source Han Serif 项目作者（Adobe、Google 及贡献者）
- Bricolage Grotesque: Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://scripts.sil.org/OFL

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
