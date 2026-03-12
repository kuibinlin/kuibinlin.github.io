module Jekyll
  class ChartTag < Liquid::Tag
    def initialize(tag_name, markup, tokens)
      super
      @chart_id = markup.strip
    end

    def render(context)
      if @chart_id.empty?
        '<div data-chart></div>'
      else
        %(<div data-chart="#{@chart_id}"></div>)
      end
    end
  end
end

Liquid::Template.register_tag('chart', Jekyll::ChartTag)
