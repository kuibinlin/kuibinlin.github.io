require 'json'

module Jekyll
  class MapTag < Liquid::Tag
    def initialize(tag_name, markup, tokens)
      super
    end

    def render(context)
      page = context.registers[:page]
      map_data = page['map']
      return '' unless map_data

      center = map_data['center']
      zoom = map_data['zoom'] || 13
      height = map_data['height'] || '450px'
      width = map_data['width'] || '100%'
      style = map_data['style'] || 'default'
      markers = map_data['markers'] || []

      <<~HTML
        <div class="leaflet-map"
          data-center="#{center.join(',')}"
          data-zoom="#{zoom}"
          data-style="#{style}"
          data-markers='#{JSON.generate(markers)}'
          style="height: #{height}; width: #{width}; border-radius: 8px;">
        </div>
      HTML
    end
  end
end

Liquid::Template.register_tag('map', Jekyll::MapTag)