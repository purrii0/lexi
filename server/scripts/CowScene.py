from manim import *

class CowScene(Scene):
    def construct(self):
        # Create objects
        cow_image = ImageMobject("cow_image").scale(0.5)
        grass_field = Rectangle(width=10, height=2, color=GREEN).to_edge(DOWN)
        self.add(grass_field)
        self.add(cow_image)
        
        # Show first caption
        caption1 = Text("गाई", font_size=28).to_edge(DOWN)
        self.play(Write(caption1), run_time=2)
        self.wait(0)
        
        # Cow image appears
        self.play(cow_image.animate.scale(1))
        self.wait(0)
        
        # Show second caption
        self.play(FadeOut(caption1))
        caption2 = Text("गाईको दुध", font_size=28).to_edge(DOWN)
        self.play(Write(caption2), run_time=3)
        self.wait(0)
        
        # Cow moves to grass field
        self.play(cow_image.animate.to_edge(DOWN))
        self.wait(0)
        
        # Show third caption
        self.play(FadeOut(caption2))
        caption3 = Text("गाई चर्दै", font_size=28).to_edge(DOWN)
        self.play(Write(caption3), run_time=4)
        self.wait(4)
        
        # Cow eats grass
        self.play(cow_image.animate.next_to(grass_field, UP))
        self.wait(2)